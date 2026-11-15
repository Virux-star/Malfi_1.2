import { createPool } from "../config/database.js";
import "dotenv/config";
import pg from "pg";
import { Resend } from "resend";
import { createOrderEmail } from "../services/orderEmailTemplates.js";

const { Pool } = pg;
const SEND = process.argv.includes("--send");
const kinds = ["payment_confirmed", "admin_new_order"];

if (SEND && (
  process.env.NODE_ENV === "production" ||
  process.env.EMAIL_MODE !== "test" ||
  !process.env.RESEND_API_KEY ||
  !process.env.EMAIL_TEST_TO
)) {
  console.error("Solo se permite enviar en modo de prueba con credenciales configuradas.");
  process.exit(1);
}

const pool = createPool();
const resend = SEND ? new Resend(process.env.RESEND_API_KEY) : null;

async function run() {
  const { rows } = await pool.query(`
    SELECT e.order_id::text AS order_id, e.kind
    FROM order_email_outbox e
    JOIN orders o ON o.id = e.order_id
    WHERE e.kind = ANY($1::text[])
      AND e.status = 'queued'
      AND o.payment_status = 'paid'
      AND o.status <> 'payment_review'
      AND o.stock_deducted_at IS NOT NULL
      AND o.inventory_reserved = FALSE
    ORDER BY e.created_at, e.order_id, e.kind
    LIMIT 20
  `, [kinds]);

  console.log(`Modo: ${SEND ? "ENVÍO DE PRUEBA" : "SOLO REVISAR"}`);
  console.log(`Notificaciones pendientes: ${rows.length}`);

  for (const { order_id: id, kind } of rows) {
    if (!SEND) {
      console.log(`Pedido #${id}: ${kind}`);
      continue;
    }

    const claimed = await pool.query(`
      UPDATE order_email_outbox e
      SET status = 'sending', attempts = attempts + 1, started_at = NOW()
      WHERE e.order_id = $1 AND e.kind = $2 AND e.status = 'queued'
        AND EXISTS (
          SELECT 1 FROM orders o WHERE o.id = e.order_id
            AND o.payment_status = 'paid'
            AND o.status <> 'payment_review'
            AND o.stock_deducted_at IS NOT NULL
            AND o.inventory_reserved = FALSE
        )
      RETURNING e.order_id
    `, [id, kind]);
    if (claimed.rowCount !== 1) continue;

    try {
      const orderResult = await pool.query(`
        SELECT customer_name, total_clp, shipping_clp, carrier
        FROM orders WHERE id = $1
          AND payment_status = 'paid'
          AND status <> 'payment_review'
          AND inventory_reserved = FALSE
          AND stock_deducted_at IS NOT NULL
      `, [id]);
      if (orderResult.rowCount !== 1) throw new Error("Pedido no elegible");

      const itemsResult = await pool.query(`
        SELECT product_name, quantity, line_total_clp
        FROM order_items WHERE order_id = $1 ORDER BY id
      `, [id]);

      const email = createOrderEmail(kind, id, orderResult.rows[0], itemsResult.rows);
      // Hasta verificar un dominio, las dos notificaciones solo llegan a EMAIL_TEST_TO.
      const { data, error } = await resend.emails.send({
        from: "MALFI Pruebas <onboarding@resend.dev>",
        to: [process.env.EMAIL_TEST_TO],
        ...email
      }, {
        idempotencyKey: `malfi-${kind}-${id}-test-v2`
      });
      if (error || !data?.id) throw new Error(error?.message || "Resend no aceptó el envío");

      await pool.query(`
        UPDATE order_email_outbox
        SET status = 'sent', provider_id = $3, sent_at = NOW(), last_error = NULL
        WHERE order_id = $1 AND kind = $2 AND status = 'sending'
      `, [id, kind, data.id]);
      console.log(`Pedido #${id}: ${kind} aceptado por Resend`);
    } catch (error) {
      // Nunca reintentar automáticamente un resultado incierto: podría duplicar correos.
      await pool.query(`
        UPDATE order_email_outbox
        SET status = 'needs_review', last_error = LEFT($3::text, 500)
        WHERE order_id = $1 AND kind = $2 AND status = 'sending'
      `, [id, kind, error.message]);
      console.error(`Pedido #${id}, ${kind}: ${error.message}`);
    }
  }
}

try {
  await run();
} catch (error) {
  console.error("Error revisando notificaciones:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
