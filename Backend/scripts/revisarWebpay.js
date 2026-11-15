import { createPool } from "../config/database.js";

import "dotenv/config";
import pg from "pg";
import transbank from "transbank-sdk";

const { Pool } = pg;

const {
  WebpayPlus,
  Options,
  Environment,
  IntegrationCommerceCodes,
  IntegrationApiKeys
} = transbank;

const ids = process.argv.slice(2).filter(
  arg => !arg.startsWith("--")
);

const release = process.argv.includes("--release-failed");

if (
  process.env.NODE_ENV === "production" ||
  process.env.WEBPAY_TEST_MODE !== "true"
) {
  console.error("Solo se permite en Webpay de integración.");
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
    "Uso: node scripts/revisarWebpay.js 7 8 [--release-failed]"
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

// Cancelar un pedido cuyo pago falló definitivamente
async function releaseFailed(id, expected) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT id, status, payment_status, inventory_reserved
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    const order = orderResult.rows[0];

    if (
      !order ||
      order.status !== "pending_payment" ||
      order.payment_status !== "pending" ||
      order.inventory_reserved !== true
    ) {
      throw new Error(
        "El pedido no tiene una reserva pendiente liberable."
      );
    }

    const attemptResult = await client.query(
      `SELECT token_ws, buy_order, session_id,
              amount_clp, state
       FROM webpay_test_attempts
       WHERE order_id = $1
       FOR UPDATE`,
      [id]
    );

    const attempt = attemptResult.rows[0];

    if (
      !attempt ||
      attempt.token_ws !== expected.token_ws ||
      attempt.buy_order !== expected.buy_order ||
      attempt.session_id !== expected.session_id ||
      String(attempt.amount_clp) !==
        String(expected.amount_clp) ||
      attempt.state === "authorized_test"
    ) {
      throw new Error(
        "El intento cambió o tiene una autorización registrada."
      );
    }

    const otherPayment = await client.query(
      `SELECT 1 FROM mercado_pago_attempts
       WHERE order_id = $1`,
      [id]
    );

    if (otherPayment.rowCount > 0) {
      throw new Error(
        "Existe un intento Mercado Pago."
      );
    }

    const itemsResult = await client.query(
      `SELECT product_id,
              SUM(quantity)::integer AS quantity
       FROM order_items
       WHERE order_id = $1
       GROUP BY product_id
       ORDER BY product_id`,
      [id]
    );

    if (!itemsResult.rowCount) {
      throw new Error("El pedido no tiene productos.");
    }

    for (const item of itemsResult.rows) {
      const changed = await client.query(
        `UPDATE products
         SET reserved_stock = reserved_stock - $1
         WHERE id = $2
           AND reserved_stock >= $1
         RETURNING id`,
        [item.quantity, item.product_id]
      );

      if (changed.rowCount !== 1) {
        throw new Error(
          "El stock reservado es inconsistente."
        );
      }
    }

    await client.query(
      `UPDATE orders
       SET status = 'cancelled',
           inventory_reserved = FALSE
       WHERE id = $1`,
      [id]
    );

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
      `Pedido #${id}: sin cambios: ${error.message}`
    );

  } finally {
    client.release();
  }
}

// Consultar estado en Transbank
try {
  for (const id of ids) {
    const found = await pool.query(
      `SELECT
         o.status AS order_status,
         o.payment_status,
         o.inventory_reserved,
         w.state AS local_state,
         w.token_ws,
         w.buy_order,
         w.session_id,
         w.amount_clp
       FROM orders o
       JOIN webpay_test_attempts w
         ON w.order_id = o.id
       WHERE o.id = $1`,
      [id]
    );

    if (!found.rowCount || !found.rows[0].token_ws) {
      console.log(
        `Pedido #${id}: sin token Webpay registrado.`
      );
      continue;
    }

    const attempt = found.rows[0];

    try {
      const bank = await tx.status(attempt.token_ws);

      const matches =
        String(bank.buy_order) === attempt.buy_order &&
        String(bank.session_id) === attempt.session_id &&
        Number(bank.amount) === Number(attempt.amount_clp);

      console.log(
        `Pedido #${id}: ` +
        `MALFI=${attempt.payment_status}/${attempt.order_status}; ` +
        `intento=${attempt.local_state}; ` +
        `Transbank=${bank.status}; ` +
        `response_code=${bank.response_code ?? "sin dato"}; ` +
        `datosCoinciden=${matches}`
      );

      if (!release) continue;

      // Solo liberar cuando Transbank confirmó
      // un fallo definitivo y los datos coinciden
      if (!matches || bank.status !== "FAILED") {
        console.log(
          `Pedido #${id}: no se libera automáticamente.`
        );
        continue;
      }

      await releaseFailed(id, attempt);

    } catch (error) {
      console.error(
        `Pedido #${id}: consulta fallida: ${error.message}`
      );
    }
  }

} finally {
  await pool.end();
}
