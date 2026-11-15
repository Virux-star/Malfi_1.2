import "dotenv/config";
import pg from "pg";
import { reconcileMultiAttemptWebpayOnce } from "../services/webpayMultiAttemptWorker.js";

const { Pool } = pg;
const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;
const pool = new Pool(connectionString ? { connectionString } : {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

try {
  console.log(`MALFI WEBPAY: ${apply ? "CONCILIAR AUTORIZACIONES" : "SOLO REVISAR"}`);
  const summary = await reconcileMultiAttemptWebpayOnce(pool, { apply });
  console.log("Resumen:", summary);
  if (summary.errors || summary.historicalAuthorized) process.exitCode = 2;
} catch (error) {
  console.error("No se pudo revisar Webpay:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
