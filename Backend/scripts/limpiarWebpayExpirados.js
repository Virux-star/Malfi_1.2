import { createPool } from "../config/database.js";

import "dotenv/config";
import pg from "pg";
import transbank from "transbank-sdk";

const { Pool } = pg;
const {
  WebpayPlus, Options, Environment,
  IntegrationCommerceCodes, IntegrationApiKeys
} = transbank;

const apply = process.argv.includes("--apply");
const ids = process.argv.slice(2).filter(x => x !== "--apply");

if (
  process.env.NODE_ENV === "production" ||
  process.env.WEBPAY_TEST_MODE !== "true"
) {
  console.error("Solo permitido en Webpay de integración.");
  process.exit(1);
}

if (
  !ids.length ||
  ids.some(id =>
    !/^[1-9]\d{0,18}$/.test(id) ||
    BigInt(id) > 9223372036854775807n
  )
) {
  console.error(
    "Uso: node scripts/limpiarWebpayExpirados.js ID1 ID2 [--apply]"
  );
  process.exit(1);
}

const pool = createPool();

const tx = new WebpayPlus.Transaction(
  new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  )
);

async function checkOrRelease(id) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Bloquear el pedido y su intento de pago
    const found = await client.query(
      `SELECT
         o.id, o.status, o.payment_status,
         o.inventory_reserved,
         w.state, w.token_ws, w.buy_order,
         w.session_id, w.amount_clp, w.finalized_at,
         EXTRACT(
           EPOCH FROM (NOW() - w.created_at)
         ) AS age_seconds
       FROM orders o
       JOIN webpay_test_attempts w
         ON w.order_id = o.id
       WHERE o.id = $1
       FOR UPDATE OF o, w`,
      [id]
    );

    if (!found.rowCount) {
      console.log(`Pedido #${id}: intento no encontrado.`);
      await client.query("ROLLBACK");
      return;
    }

    const a = found.rows[0];

    // Solo pedidos de prueba antiguos y sin pagar
    if (
      a.status !== "pending_payment" ||
      a.payment_status !== "pending" ||
      a.inventory_reserved !== true ||
      a.finalized_at !== null ||
      !["created", "review"].includes(a.state) ||
      Number(a.age_seconds) < 20 * 60 ||
      !a.token_ws
    ) {
      console.log(
        `Pedido #${id}: no cumple las condiciones.`
      );
      await client.query("ROLLBACK");
      return;
    }

    // No mezclar con Mercado Pago
    const other = await client.query(
      `SELECT 1 FROM mercado_pago_attempts
       WHERE order_id = $1`,
      [id]
    );

    if (other.rowCount) {
      console.log(
        `Pedido #${id}: tiene intento Mercado Pago.`
      );
      await client.query("ROLLBACK");
      return;
    }

    // Consultar el estado directamente a Transbank
    const bank = await tx.status(a.token_ws);

    const matches =
      bank.status === "INITIALIZED" &&
      String(bank.buy_order) === a.buy_order &&
      String(bank.session_id) === a.session_id &&
      Number.isSafeInteger(Number(bank.amount)) &&
      Number(bank.amount) === Number(a.amount_clp);

    console.log(
      `Pedido #${id}: Transbank=${bank.status}, ` +
      `edad=${Math.round(Number(a.age_seconds) / 60)} min, ` +
      `datosCoinciden=${matches}`
    );

    if (!matches) {
      console.log("Sin cambios: requiere revisión.");
      await client.query("ROLLBACK");
      return;
    }

    // Solo revisión, no modificar nada
    if (!apply) {
      console.log("Candidato a liberar.");
      await client.query("ROLLBACK");
      return;
    }

    // Recuperar productos del pedido
    const items = await client.query(
      `SELECT product_id,
              SUM(quantity)::integer AS quantity
       FROM order_items
       WHERE order_id = $1
       GROUP BY product_id
       ORDER BY product_id`,
      [id]
    );

    if (!items.rowCount) {
      throw new Error("Pedido sin productos.");
    }

    // Bloquear inventario
    const locked = await client.query(
      `SELECT id FROM products
       WHERE id = ANY($1::integer[])
       ORDER BY id
       FOR UPDATE`,
      [items.rows.map(item => item.product_id)]
    );

    if (locked.rowCount !== items.rowCount) {
      throw new Error("Faltan productos.");
    }

    // Liberar la reserva, sin tocar el stock físico
    for (const item of items.rows) {
      const updated = await client.query(
        `UPDATE products
         SET reserved_stock = reserved_stock - $1
         WHERE id = $2
           AND reserved_stock >= $1
         RETURNING id`,
        [item.quantity, item.product_id]
      );

      if (updated.rowCount !== 1) {
        throw new Error("Reserva inconsistente.");
      }
    }

    // Cancelar el pedido de prueba
    await client.query(
      `UPDATE orders
       SET status = 'cancelled',
           inventory_reserved = FALSE
       WHERE id = $1`,
      [id]
    );

    // Conservar historial del intento fallido
    await client.query(
      `UPDATE webpay_test_attempts
       SET state = 'rejected_test',
           updated_at = NOW()
       WHERE order_id = $1`,
      [id]
    );

    await client.query("COMMIT");

    console.log(
      `Pedido #${id}: cancelado y reserva liberada.`
    );

  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      `Pedido #${id}: sin cambios (${error.message}).`
    );
  } finally {
    client.release();
  }
}

try {
  console.log(
    apply ? "MODO APLICAR" : "MODO SOLO REVISAR"
  );

  for (const id of ids) {
    await checkOrRelease(id);
  }
} finally {
  await pool.end();
}
