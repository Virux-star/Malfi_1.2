import { spawnSync } from 'node:child_process';

let target;
try { target = new URL(process.env.TEST_DATABASE_URL || ''); } catch {}
if (!target || !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/(?:test|qa)/i.test(target.pathname)) {
  console.error('Configura TEST_DATABASE_URL con una base PostgreSQL local exclusiva de pruebas, por ejemplo malfi_qa.');
  console.error('Este comando no utiliza la base de producción.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
  'Backend/tests/productOptions.test.js', 'Backend/tests/productOptions.integration.test.js', 'Frontend/src/lib/cart.test.js'], {
  stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test', DB_SSL: 'false' }
});
if (result.error) { console.error('No se pudieron iniciar las pruebas.'); process.exit(1); }
process.exit(result.status ?? 1);
