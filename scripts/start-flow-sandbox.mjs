import { runtimeConfig } from '../Backend/config/runtime.js';
import { createPool } from '../Backend/config/database.js';
import { createFlowClient } from '../Backend/services/flowClient.js';
import { assertFlowSandbox, bootstrapFlowSandbox } from '../Backend/services/flowSandbox.js';

const config=runtimeConfig();
// Validate the target before even opening a database connection.
assertFlowSandbox(config,process.env);
const pool=createPool();
try{
  await bootstrapFlowSandbox(pool,config,process.env,createFlowClient(config));
  console.log('Flow Sandbox verificado por consulta de lectura. Administración y productos ficticios preparados.');
}finally{await pool.end();}
await import('../Backend/server.js');
