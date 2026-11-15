import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPool } from '../config/database.js';

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(20261115, 2000)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = fileURLToPath(new URL('../sql/', import.meta.url));
    for (const name of (await readdir(dir)).filter(n => /^\d+_.*\.sql$/.test(n)).sort()) {
      const sql = await readFile(`${dir}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) throw new Error(`La migración ${name} cambió después de aplicarse.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
        await client.query('COMMIT');
        console.log(`Migración aplicada: ${name}`);
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(20261115, 2000)'); client.release(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try { await migrate(pool); } catch (e) { console.error('Migración fallida:', e.message); process.exitCode=1; }
  finally { await pool.end(); }
}
