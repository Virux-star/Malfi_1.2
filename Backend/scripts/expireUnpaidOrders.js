// Ejecutar desde backend/: node scripts/expireUnpaidOrders.js [--apply]
import "dotenv/config";
import pg from "pg";
import { expireUnstartedOrdersOnce } from "../services/reservationExpiry.js";

const { Pool } = pg;
const apply = process.argv.includes("--apply");
const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

try {
  const result = await expireUnstartedOrdersOnce(pool, { apply });
  console.log("Resumen:", result);
  if (result.errors) process.exitCode = 1;
} catch (error) {
  console.error("Error revisando reservas:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
