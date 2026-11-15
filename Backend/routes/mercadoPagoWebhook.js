
import { WebhookSignatureValidator } from "mercadopago";

// Aceptar importes enteros en CLP
function parseCLP(value) {
  const text = String(value ?? "");

  if (!/^\d+(?:\.0{1,2})?$/.test(text)) {
    return null;
  }

  return BigInt(text.split(".")[0]);
}

export function registerMercadoPagoWebhook(app, pool) {
  app.post("/api/webhooks/mercadopago", async (req, res) => {

    // Este endpoint será SOLO para nuestras pruebas
    if (
      process.env.NODE_ENV === "production" ||
      process.env.MP_TEST_MODE !== "true"
    ) {
      return res.sendStatus(503);
    }

    const secret = process.env.MP_WEBHOOK_SECRET;

    if (!secret || secret === "TU_FIRMA_SECRETA") {
      return res.sendStatus(503);
    }

    const mpOrderId = req.query["data.id"];

    if (
      req.query.type !== "order" ||
      typeof mpOrderId !== "string" ||
      !/^[A-Za-z0-9_-]{10,100}$/.test(mpOrderId)
    ) {
      return res.sendStatus(400);
    }

    // Comprobar coherencia de la notificación
    if (
      (req.body?.type && req.body.type !== "order") ||
      (req.body?.data?.id &&
        req.body.data.id !== mpOrderId) ||
      req.body?.live_mode === true
    ) {
      return res.sendStatus(400);
    }

    // 1. VERIFICAR FIRMA DE MERCADO PAGO
    try {
      WebhookSignatureValidator.validate({
        xSignature: req.get("x-signature"),
        xRequestId: req.get("x-request-id"),
        dataId: mpOrderId,
        secret
      });
    } catch {
      console.warn("Webhook con firma no válida");
      return res.sendStatus(401);
    }

    let client;

    try {
      // 2. Buscar la orden externa en nuestra BD
      const attemptResult = await pool.query(
        `SELECT order_id
         FROM mercado_pago_attempts
         WHERE mp_order_id = $1`,
        [mpOrderId]
      );

      if (attemptResult.rows.length === 0) {
        console.warn("Orden MP no vinculada:", mpOrderId);
        return res.sendStatus(200);
      }

      const orderId = String(
        attemptResult.rows[0].order_id
      );

      // 3. Consultar la orden directamente a Mercado Pago
      const response = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(mpOrderId)}`,
        {
          headers: {
            Authorization:
              `Bearer ${process.env.MP_ACCESS_TOKEN}`
          },
          signal: AbortSignal.timeout(9000)
        }
      );

      if (!response.ok) {
        throw new Error(
          `Error consultando Mercado Pago: ${response.status}`
        );
      }

      const mpOrder = await response.json();

      // 4. Comprobar los datos de la orden
      if (
        mpOrder.id !== mpOrderId ||
        mpOrder.external_reference !== `malfi_${orderId}` ||
        (mpOrder.currency ?? mpOrder.currency_id) !== "CLP" ||
        mpOrder.live_mode === true
      ) {
        console.error("Inconsistencia en orden Mercado Pago");
        return res.sendStatus(409);
      }

      // No marcar pagos pendientes como aprobados
      if (
        mpOrder.status !== "processed" ||
        mpOrder.status_detail !== "accredited"
      ) {
        console.log("Orden MP todavía no acreditada");
        return res.sendStatus(200);
      }

      const payments = mpOrder.transactions?.payments;

      if (
        !Array.isArray(payments) ||
        !payments.some(
          (payment) =>
            payment.status === "processed" &&
            payment.status_detail === "accredited"
        )
      ) {
        console.warn("Pago sin transacción acreditada");
        return res.sendStatus(200);
      }

      const paidAmount = parseCLP(
        mpOrder.total_paid_amount
      );

      const orderAmount = parseCLP(
        mpOrder.total_amount
      );

      if (
        paidAmount === null ||
        orderAmount === null ||
        paidAmount !== orderAmount
      ) {
        console.error("Importes no válidos en Mercado Pago");
        return res.sendStatus(409);
      }

      // 5. Iniciar transacción PostgreSQL
      client = await pool.connect();

      await client.query("BEGIN");

      // Bloquear este pedido para evitar procesarlo dos veces
      const orderResult = await client.query(
        `SELECT
           id,
           status,
           payment_status,
           total_clp,
           inventory_reserved
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Pedido MALFI no encontrado");
      }

      const order = orderResult.rows[0];

      if (BigInt(order.total_clp) !== paidAmount) {
        throw new Error("Importe pagado distinto al pedido");
      }

      // IDEMPOTENCIA:
      // Si ya se procesó el pago, no volver a descontar
      if (order.payment_status === "paid") {
        await client.query("COMMIT");
        return res.sendStatus(200);
      }

      if (order.payment_status !== "pending") {
        throw new Error(
          "Pedido con estado de pago incompatible"
        );
      }

      // 6. Obtener productos del pedido
      const itemsResult = await client.query(
        `SELECT product_id, quantity
         FROM order_items
         WHERE order_id = $1
         ORDER BY product_id`,
        [orderId]
      );

      const items = itemsResult.rows;

      if (items.length === 0) {
        throw new Error("El pedido no tiene productos");
      }

      const productIds = items.map(
        (item) => item.product_id
      );

      // Bloquear filas de inventario
      const stockResult = await client.query(
        `SELECT id, stock, reserved_stock
         FROM products
         WHERE id = ANY($1::integer[])
         ORDER BY id
         FOR UPDATE`,
        [productIds]
      );

      const productMap = new Map(
        stockResult.rows.map((product) => [
          product.id,
          product
        ])
      );

      // Solo convertir la reserva si el pedido sigue vigente
      // y cada producto conserva las unidades reservadas.
      const canFulfill =
        order.status === "pending_payment" &&
        order.inventory_reserved === true &&
        items.every((item) => {
          const product = productMap.get(item.product_id);

          return (
            product &&
            product.reserved_stock >= item.quantity &&
            product.stock >= item.quantity
          );
        });

      // 7. Descontar stock UNA SOLA VEZ
      if (canFulfill) {
        for (const item of items) {
          const updated = await client.query(
            `UPDATE products
             SET stock = stock - $1,
                 reserved_stock = reserved_stock - $1
             WHERE id = $2
               AND reserved_stock >= $1
               AND stock >= $1
             RETURNING id`,
            [item.quantity, item.product_id]
          );

          if (updated.rowCount !== 1) {
            throw new Error(
              "El inventario cambió durante la transacción"
            );
          }
        }
      }

      // Si falta stock o el pedido fue cancelado,
      // registrar el pago pero bloquear su preparación
      const nextStatus = canFulfill
        ? "pending_payment"
        : "payment_review";

      // 8. Confirmar el pago
      await client.query(
        `UPDATE orders
         SET payment_status = 'paid',
             status = $2,
             paid_at = CURRENT_TIMESTAMP,
             inventory_reserved = CASE
               WHEN $3::boolean THEN FALSE
               ELSE inventory_reserved
             END,
             stock_deducted_at = CASE
               WHEN $3::boolean
               THEN CURRENT_TIMESTAMP
               ELSE NULL
             END
         WHERE id = $1`,
        [orderId, nextStatus, canFulfill]
      );

      // Preparar correo solo si el pago se confirmó
      // y el inventario se descontó correctamente.
      if (canFulfill) {
       await client.query(
         `INSERT INTO order_email_outbox (order_id, kind)
          VALUES
            ($1, 'payment_confirmed'),
            ($1, 'admin_new_order')
          ON CONFLICT (order_id, kind) DO NOTHING`,
         [orderId]
       );
      }

      // Pedido + inventario se actualizan juntos
      await client.query("COMMIT");

      console.log(
        `Pedido MALFI #${orderId}: pago verificado`,
        canFulfill
          ? "Stock descontado"
          : "Requiere revisión de inventario"
      );

      return res.sendStatus(200);

    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Error en rollback:", rollbackError);
        }
      }

      console.error(
        "Error procesando webhook Mercado Pago:",
        error.message
      );

      // Mercado Pago podrá reintentar la notificación
      return res.sendStatus(500);

    } finally {
      if (client) client.release();
    }
  });
}
