import { createPool } from '../Backend/config/database.js';
import { migrate } from '../Backend/scripts/migrate.js';
const pool=createPool();
try {await migrate(pool);} finally {await pool.end();}
await import('../Backend/server.js');
