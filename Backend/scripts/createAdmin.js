import { createPool } from "../config/database.js";

import "dotenv/config";
import bcrypt from "bcryptjs";
import { input, password } from "@inquirer/prompts";


const pool = createPool();
const reset = process.argv.includes("--reset-password");

try {
  const email = (
    await input({
      message: "Correo de la administradora:"
    })
  ).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Correo no válido.");
  }

  const existing = reset ? await pool.query("SELECT id FROM admin_users WHERE email=$1", [email]) : null;
  if (reset && !existing.rowCount) throw new Error("No existe una cuenta con ese correo.");
  const adminPassword = await password({
    message: "Crea una contraseña segura:",
    mask: "*",
    toggleMask: false,
    validate: (value) => {
      const bytes = Buffer.byteLength(value, "utf8");

      if (value.length < 12) {
        return "Utiliza al menos 12 caracteres.";
      }

      if (bytes > 72) {
        return "La contraseña es demasiado larga.";
      }

      return true;
    }
  });

  const hash = await bcrypt.hash(adminPassword, 12);

  if (reset) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE admin_users SET password_hash=$2 WHERE email=$1", [email, hash]);
      await client.query("DELETE FROM admin_sessions WHERE sess::jsonb->>'adminId'=$1", [String(existing.rows[0].id)]);
      await client.query("COMMIT");
      console.log("Contraseña actualizada. Las sesiones anteriores fueron cerradas.");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } else {
    const result = await pool.query(
      `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING RETURNING id`, [email, hash]
    );
    console.log(result.rowCount ? "Cuenta administradora creada correctamente." : "Ya existe una cuenta con ese correo. Usa admin:reset si necesitas cambiar su contraseña.");
  }

} catch (error) {
  console.error("No se pudo crear la cuenta:", error.message);
  process.exitCode = 1;

} finally {
  await pool.end();
}
