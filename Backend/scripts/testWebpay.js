
import "dotenv/config";

import transbank from "transbank-sdk";

const {
  Environment,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Options,
  WebpayPlus
} = transbank;

import { randomUUID } from "node:crypto";

// Evitar utilizar credenciales reales en esta prueba
if (
  process.env.NODE_ENV === "production" ||
  process.env.WEBPAY_TEST_MODE !== "true"
) {
  console.error(
    "La prueba de Webpay está deshabilitada."
  );

  process.exit(1);
}

// Crear una conexión con el ambiente de integración
const transaction = new WebpayPlus.Transaction(
  new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  )
);

async function testWebpay() {
  try {
    console.log("Conectando MALFI con Transbank...");

    // Identificadores únicos para una transacción ficticia
    const buyOrder =
      "MALFI-T-" + randomUUID().slice(0, 12);

    const sessionId = randomUUID();

    // Importe de prueba: $1.000 CLP
    const amount = 1000;

    // Esta ruta de retorno se implementará
    // en la siguiente parte de la integración
    const returnUrl =
      "http://localhost:3000/api/webpay/test/return";

    const result = await transaction.create(
      buyOrder,
      sessionId,
      amount,
      returnUrl
    );

    if (!result.token || !result.url) {
      throw new Error(
        "Transbank no devolvió una transacción válida."
      );
    }

    console.log("¡Conexión exitosa!");
    console.log("Orden de prueba:", buyOrder);
    console.log("Importe:", amount, "CLP");
    console.log("URL de Webpay:", result.url);
    console.log("Token de transacción recibido.");

    console.log(
      "La transacción fue creada, pero todavía no se ha pagado."
    );

  } catch (error) {
    console.error(
      "Error al conectar Webpay:",
      error.message
    );

    process.exitCode = 1;
  }
}

await testWebpay();
