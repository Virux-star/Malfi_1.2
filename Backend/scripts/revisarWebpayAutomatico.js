import { createPool } from "../config/database.js";
import "dotenv/config";
import pg from "pg";
import { reconcileWebpayOnce } from "../services/webpayReconciliation.js";

const { Pool } = pg;
const apply = process.argv.includes("--apply");
const pool = createPool();

try {
  console.log(apply ? "MALFI: CONCILIAR PRUEBAS" : "MALFI: SOLO REVISAR");
  const result = await reconcileWebpayOnce(pool, { apply });
  console.log("Resumen:", result);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
