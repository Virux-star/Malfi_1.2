import 'dotenv/config';
import { runtimeConfig } from '../config/runtime.js';
import { createMercadoPagoClient } from '../services/mercadoPagoClient.js';
import { paymentProviders } from '../config/paymentProviders.js';
try {
  const config=runtimeConfig(),client=createMercadoPagoClient(config);
  if(!client)throw new Error('Configura MP_MODE=integration y MP_ACCESS_TOKEN con las credenciales de prueba de tu aplicación.');
  const seller=await client.getSeller();
  const test=Array.isArray(seller.tags)&&seller.tags.includes('test_user');
  console.log('ID del vendedor (MP_COLLECTOR_ID):',String(seller.id));
  console.log('País:',seller.site_id==='MLC'?'Chile':seller.site_id||'No identificado');
  console.log('Cuenta:',test?'Prueba':'Real o sin marca test_user');
  if(seller.site_id!=='MLC')throw new Error('Usa una cuenta vendedora de Chile.');
  if((config.mpMode==='integration')!==test)throw new Error('La cuenta no coincide con MP_MODE. En integración se exige una cuenta de prueba.');
  if(String(seller.id)!==config.mpCollectorId)console.log('Copia el ID anterior en MP_COLLECTOR_ID de Backend/.env.');
  const options=paymentProviders(config);
  for(const issue of options.issues.filter(i=>i.startsWith('Mercado Pago:')))console.log(issue);
  console.log('La consulta fue de solo lectura. No se crearon preferencias ni cobros.');
} catch(e){console.error('Revisión Mercado Pago:',e.message);process.exitCode=1;}
