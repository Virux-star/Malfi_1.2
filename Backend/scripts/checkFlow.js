import 'dotenv/config';
import { runtimeConfig } from '../config/runtime.js';
import { createFlowClient } from '../services/flowClient.js';
import { paymentProviders } from '../config/paymentProviders.js';
try {
  const config=runtimeConfig(),client=createFlowClient(config);
  if(!client)throw new Error('Configura FLOW_MODE y las claves FLOW_API_KEY y FLOW_SECRET_KEY del mismo ambiente.');
  await client.checkCredentials();
  console.log('Flow: credenciales aceptadas para una consulta de lectura.');
  console.log('Ambiente:',config.flowMode==='production'?'Producción':'Sandbox (pruebas)');
  for(const issue of paymentProviders(config).issues.filter(i=>i.startsWith('Flow:')))console.log(issue);
  console.log('No se crearon órdenes ni se realizaron cobros.');
} catch(e){console.error('Revisión Flow:',e.message);process.exitCode=1;}
