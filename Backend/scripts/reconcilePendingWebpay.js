import { createPool } from "../config/database.js";

import "dotenv/config";
import pg from "pg";
import transbank from "transbank-sdk";
import { finalizeWebpayTest } from "../routes/webpayFinalize.js";

const { Pool } = pg;

const {
  WebpayPlus,
  Options,
  Environment,
  IntegrationCommerceCodes,
  IntegrationApiKeys
} = transbank;

const APPLY = process.argv.includes("--apply");

// Esta herramienta es exclusivamente de pruebas.
if (
  process.env.NODE_ENV === "production" ||
  process.env.WEBPAY_TEST_MODE !== "true"
) {
  console.error("La conciliación de prueba está deshabilitada.");
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

async function main() {
  // Consultar pagos pendientes de completar en MALFI.
  const result = await pool.query(`
    SELECT
      w.order_id::text AS order_id,
      w.state AS webpay_state,
      o.payment_status,
      o.status AS order_status,
      o.inventory_reserved,
      w.updated_at
    FROM webpay_test_attempts AS w
    JOIN orders AS o ON o.id = w.order_id
    WHERE w.finalized_at IS NULL
      AND o.payment_status = 'pending'
      AND w.state IN (
        'authorized_test',
        'review',
        'processing',
        'created'
      )
    ORDER BY w.created_at ASC
    LIMIT 100
  `);

  console.log(
    `Modo: ${APPLY ? "CONCILIAR" : "SOLO REVISAR"}`
  );

  console.log(
    `Intentos pendientes encontrados: ${result.rows.length}`
  );

  for (const payment of result.rows) {
    const id = payment.order_id;

    // No asumir que un intento iniciado está pagado.
    if (payment.webpay_state !== "authorized_test") {
      console.log(
        `Pedido #${id}: ${payment.webpay_state} - requiere revisión.`
      );
      continue;
    }

    if (!APPLY) {
      console.log(
        `Pedido #${id}: autorización registrada, listo para verificar.`
      );
      continue;
    }

    try {
      // Verifica la autorización directamente con Transbank.
      // La función existente controla también la actualización
      // transaccional del pedido, reserva e inventario.
      const outcome = await finalizeWebpayTest(
        pool,
        tx,
        id
      );

      console.log(
        `Pedido #${id}: ${outcome.outcome}`
      );

    } catch (error) {
      console.error(
        `Pedido #${id}: requiere revisión - ${error.message}`
      );
    }
  }

  // Detectar registros inconsistentes sin modificarlos.
  const anomalies = await pool.query(`
    SELECT w.order_id::text AS order_id
    FROM webpay_test_attempts AS w
    JOIN orders AS o ON o.id = w.order_id
    WHERE o.payment_status = 'paid'
      AND w.finalized_at IS NULL
    ORDER BY w.created_at ASC
    LIMIT 20
  `);

  if (anomalies.rows.length > 0) {
    console.warn(
      "Pedidos pagados sin finalización registrada:",
      anomalies.rows.map(row => row.order_id).join(", ")
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(
    "No se pudieron consultar los pagos:",
    error.message
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
