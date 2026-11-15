
import "dotenv/config";
import pg from "pg";
import transbank from "transbank-sdk";

const { Pool } = pg;

const {
  Environment,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Options,
  WebpayPlus
} = transbank;

const [orderId, attemptNo] = process.argv.slice(2);

// Solo permitir pruebas de integración
if (
  process.env.NODE_ENV === "production" ||
  process.env.WEBPAY_TEST_MODE !== "true"
) {
  console.error(
    "Este diagnóstico solo funciona en integración."
  );
  process.exit(1);
}

// Validar los parámetros
if (
  !/^\d+$/.test(orderId ?? "") ||
  !/^\d+$/.test(attemptNo ?? "") ||
  BigInt(orderId) < 1n ||
  BigInt(orderId) > 9223372036854775807n ||
  !Number.isSafeInteger(Number(attemptNo)) ||
  Number(attemptNo) < 1
) {
  console.error(
    "Uso: node scripts/diagnosticarWebpayIntento.js 16 3"
  );
  process.exit(1);
}

// Conexión a PostgreSQL
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
      }
);

try {
  // Consultar el intento específico
  const result = await pool.query(
    `SELECT
       o.id,
       o.status AS order_status,
       o.payment_status,
       o.inventory_reserved,
       o.total_clp,

       w.attempt_no,
       w.is_current,
       w.state AS local_state,
       w.last_bank_status,
       w.last_status_check_at,
       w.return_reason,
       w.response_code AS local_response_code,
       w.created_at,

       w.token_ws,
       w.buy_order,
       w.session_id,
       w.amount_clp

     FROM orders o

     JOIN webpay_test_attempts w
       ON w.order_id = o.id

     WHERE o.id = $1
       AND w.attempt_no = $2`,
    [orderId, Number(attemptNo)]
  );

  if (result.rowCount !== 1) {
    console.log(
      "No se encontró el intento solicitado."
    );
  } else {
    const a = result.rows[0];

    console.log("\nMALFI (base de datos):");

    console.log({
      pedido: String(a.id),
      intento: a.attempt_no,
      pedidoEstado: a.order_status,
      pago: a.payment_status,
      reservaActiva: a.inventory_reserved,
      intentoActual: a.is_current,
      intentoLocal: a.local_state,
      ultimoEstadoGuardado: a.last_bank_status,
      ultimaConsulta: a.last_status_check_at,
      motivoRetorno: a.return_reason,
      codigoLocal: a.local_response_code,
      creado: a.created_at,
      montoPedido: String(a.total_clp),
      montoIntento: String(a.amount_clp)
    });

    if (!a.token_ws) {
      console.log(
        "El intento no tiene token Webpay registrado."
      );
    } else {
      // Consultar directamente a Transbank
      const tx = new WebpayPlus.Transaction(
        new Options(
          IntegrationCommerceCodes.WEBPAY_PLUS,
          IntegrationApiKeys.WEBPAY,
          Environment.Integration
        )
      );

      const bank = await tx.status(a.token_ws);

      // Comprobar datos de la transacción
      const coincide =
        String(bank.buy_order) === a.buy_order &&
        String(bank.session_id) === a.session_id &&
        Number.isSafeInteger(Number(bank.amount)) &&
        Number(bank.amount) === Number(a.amount_clp);

      const autorizada =
        coincide &&
        bank.status === "AUTHORIZED" &&
        String(bank.response_code) === "0";

      console.log("\nTRANSBANK (consulta actual):");

      console.log({
        estado: bank.status ?? null,
        codigoRespuesta: bank.response_code ?? null,
        datosCoinciden: coincide,
        autorizada
      });

      if (!coincide) {
        console.warn(
          "ATENCIÓN: los datos no coinciden."
        );
      }

      if (bank.status === "INITIALIZED") {
        console.log(
          "\nLa transacción todavía no tiene " +
          "una autorización confirmada."
        );
      }
    }
  }

} catch (error) {
  console.error(
    "Error al diagnosticar Webpay:",
    error.message
  );

  process.exitCode = 1;

} finally {
  await pool.end();
}
