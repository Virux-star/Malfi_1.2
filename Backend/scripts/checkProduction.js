import { paymentProviders } from '../config/paymentProviders.js';
import { createMercadoPagoClient } from '../services/mercadoPagoClient.js';
import { verifyMpSeller } from '../services/mercadoPago.js';
import 'dotenv/config';
import { createPool } from '../config/database.js';
import { runtimeConfig } from '../config/runtime.js';
import { readiness } from '../services/store.js';
const pool=createPool();
try{
  const config=runtimeConfig(),r=await readiness(pool,config);
  const issues=[...r.issues];
  if(!config.production)issues.push('Configura NODE_ENV=production.');
  const options=paymentProviders(config);
  if(!options.providers.some(p=>p.mode==='production'))issues.push('Configura al menos una pasarela productiva.');
  for(const p of options.providers)if(p.mode!=='production')issues.push(`${p.label}: cambia a producción o desactiva esa opción antes de abrir ventas.`);
  issues.push(...options.issues);
  if(options.providers.some(p=>p.id==='mercadopago')){try{await verifyMpSeller(createMercadoPagoClient(config),config);}catch(e){issues.push(e.message);}}
  if(config.allowIntegration)issues.push('Desactiva ALLOW_INTEGRATION_CHECKOUT.');
  if(!(await pool.query('SELECT 1 FROM admin_users WHERE active=TRUE LIMIT 1')).rowCount)issues.push('Crea una cuenta administradora.');
  if(!process.env.CLOUDINARY_CLOUD_NAME||!process.env.CLOUDINARY_API_KEY||!process.env.CLOUDINARY_API_SECRET)issues.push('Configura Cloudinary para administrar fotografías.');
  const incomplete=await pool.query("SELECT COUNT(*)::int AS n FROM products WHERE active=TRUE AND (COALESCE(trim(description),'')='' OR COALESCE(image_url,'')='')");
  if(incomplete.rows[0].n)issues.push(`${incomplete.rows[0].n} producto(s) activos sin descripción o fotografía.`);
  const review=await pool.query("SELECT COUNT(*)::int AS n FROM webpay_payments WHERE state='review'");
  const mpReview=await pool.query("SELECT COUNT(*)::int AS n FROM mercadopago_checkouts WHERE state='review'");
  if(mpReview.rows[0].n)console.log(`Atención operativa: ${mpReview.rows[0].n} checkout(s) de Mercado Pago requieren revisión.`);
  if(review.rows[0].n)console.log(`Atención operativa: ${review.rows[0].n} pago(s) requieren conciliación.`);
  if(issues.length){console.error('Configuración pendiente:\n'+issues.map(x=>`- ${x}`).join('\n'));process.exitCode=1;}
  else console.log('Configuración de producción completa. Falta confirmar con una compra real controlada y comprobar correo, boleta y despacho.');
}catch(e){console.error('No se pudo verificar la publicación:',e.message);process.exitCode=1;}finally{await pool.end();}
