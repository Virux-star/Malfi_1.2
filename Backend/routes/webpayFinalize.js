// MALFI - Etapa 18.8. SOLO ambiente de integracion.
// Firma nueva: finalizeWebpayTest(pool, tx, orderId, attemptId)
function approved(bank, attempt) {
  return bank?.status === "AUTHORIZED" && Number(bank.response_code) === 0 &&
    String(bank.buy_order) === attempt.buy_order &&
    String(bank.session_id) === attempt.session_id &&
    Number.isSafeInteger(Number(bank.amount)) &&
    Number(bank.amount) === Number(attempt.amount_clp);
}

export async function finalizeWebpayTest(pool, tx, orderId, attemptId) {
  if (!attemptId) throw new Error("La conciliacion requiere el ID del intento Webpay.");
  const initial = await pool.query(
    `SELECT attempt_id, order_id, token_ws, buy_order, session_id, amount_clp, state, is_current
     FROM webpay_test_attempts WHERE attempt_id = $1 AND order_id = $2`,
    [attemptId, orderId]
  );
  if (initial.rowCount !== 1 || initial.rows[0].state !== "authorized_test" ||
      !initial.rows[0].token_ws) {
    throw new Error("El intento seleccionado no figura como autorizado.");
  }
  const attempt = initial.rows[0];
  // No podemos convertir en venta una autorizacion tardia de un intento viejo.
  if (!attempt.is_current) throw new Error("Autorizacion en intento historico: revision manual.");
  const bank = await tx.status(attempt.token_ws);
  if (!approved(bank, attempt)) throw new Error("Transbank no confirma la autorizacion de este intento.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT id, status, payment_status, inventory_reserved, total_clp, stock_deducted_at
       FROM orders WHERE id=$1 FOR UPDATE`, [orderId]
    );
    if (orderResult.rowCount !== 1) throw new Error("Pedido no encontrado.");
    const order = orderResult.rows[0];
    const currentResult = await client.query(
      `SELECT attempt_id, token_ws, buy_order, session_id, amount_clp,
              state, finalized_at, is_current
       FROM webpay_test_attempts WHERE attempt_id=$1 AND order_id=$2 FOR UPDATE`,
      [attemptId, orderId]
    );
    const current = currentResult.rows[0];
    if (!current || !current.is_current || current.state !== "authorized_test" ||
        current.token_ws !== attempt.token_ws ||
        current.buy_order !== attempt.buy_order ||
        current.session_id !== attempt.session_id ||
        String(current.amount_clp) !== String(attempt.amount_clp)) {
      throw new Error("El intento cambio durante la confirmacion.");
    }
    if (BigInt(String(order.total_clp)) !== BigInt(String(attempt.amount_clp))) {
      throw new Error("El monto no coincide con el pedido.");
    }
    const other = await client.query(
      `SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1`, [orderId]
    );
    if (other.rowCount) throw new Error("Pedido con intento Mercado Pago: revision manual.");

    if (order.payment_status === "paid") {
      if (!current.finalized_at) {
        throw new Error("Pedido pagado sin finalizacion del intento: revision manual.");
      }
      await client.query("COMMIT");
      return { outcome: "already_paid", orderId: String(orderId) };
    }
    if (order.payment_status !== "pending" || current.finalized_at) {
      throw new Error("Estado incompatible con una nueva confirmacion.");
    }

    const itemsRes = await client.query(
      `SELECT product_id, SUM(quantity)::integer AS quantity
       FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id`,
      [orderId]
    );
    if (!itemsRes.rowCount) throw new Error("Pedido sin productos.");
    const items = itemsRes.rows;
    const productsRes = await client.query(
      `SELECT id,stock,reserved_stock FROM products
       WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE`,
      [items.map(x => x.product_id)]
    );
    const byId = new Map(productsRes.rows.map(p => [p.id, p]));
    const canFulfill = order.status === "pending_payment" &&
      order.inventory_reserved === true && order.stock_deducted_at === null &&
      items.every(item => {
        const p = byId.get(item.product_id);
        return p && Number.isSafeInteger(Number(item.quantity)) &&
          Number(p.stock) >= Number(item.quantity) &&
          Number(p.reserved_stock) >= Number(item.quantity);
      });

    if (canFulfill) {
      for (const item of items) {
        const change = await client.query(
          `UPDATE products
           SET stock=stock-$1,reserved_stock=reserved_stock-$1
           WHERE id=$2 AND stock >= $1 AND reserved_stock >= $1 RETURNING id`,
          [item.quantity, item.product_id]
        );
        if (change.rowCount !== 1) throw new Error("No se pudo convertir la reserva en venta.");
      }
    }

    const orderSaved = await client.query(
      `UPDATE orders SET payment_status='paid',
        status=$2::varchar,
        paid_at=COALESCE(paid_at,NOW()),
        inventory_reserved=CASE WHEN $3::boolean THEN FALSE ELSE inventory_reserved END,
        stock_deducted_at=CASE WHEN $3::boolean
                               THEN COALESCE(stock_deducted_at,NOW()) ELSE stock_deducted_at END
       WHERE id=$1 AND payment_status='pending' RETURNING id`,
      [orderId, canFulfill ? "pending_payment" : "payment_review", canFulfill]
    );
    if (orderSaved.rowCount !== 1) throw new Error("No se pudo marcar el pedido como pagado.");
    const done = await client.query(
      `UPDATE webpay_test_attempts SET finalized_at=NOW(),updated_at=NOW()
       WHERE attempt_id=$1 AND state='authorized_test' AND finalized_at IS NULL
       RETURNING attempt_id`,
      [attemptId]
    );
    if (done.rowCount !== 1) throw new Error("Intento ya finalizado.");

    // Mantener las dos notificaciones de la etapa 19 si existe su tabla.
    if (canFulfill) {
      const mailTable = await client.query("SELECT to_regclass('public.order_email_outbox') AS rel");
      if (mailTable.rows[0]?.rel) {
        await client.query(
          `INSERT INTO order_email_outbox (order_id,kind)
           VALUES ($1,'payment_confirmed'),($1,'admin_new_order')
           ON CONFLICT (order_id,kind) DO NOTHING`, [orderId]
        );
      }
    }

    await client.query("COMMIT");
    return { outcome: canFulfill ? "paid" : "payment_review", orderId: String(orderId) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
