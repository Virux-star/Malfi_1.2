import bcrypt from 'bcryptjs';
import { migrate } from '../scripts/migrate.js';
import { defaultStore } from './store.js';

export function assertFlowSandbox(config, env) {
  let databaseName;
  try {
    const url=new URL(env.DATABASE_URL);
    databaseName=decodeURIComponent(url.pathname.slice(1));
    if(!['postgres:','postgresql:'].includes(url.protocol)||!/^malfi_(?:flow_pruebas|qa)(?:_[a-z0-9]+)?$/.test(databaseName))throw Error();
  }catch{throw new Error('El arranque Sandbox requiere una base separada llamada malfi_flow_pruebas.');}
  if(env.FLOW_SANDBOX_SETUP!=='true'||config.flowMode!=='integration'||config.mode!=='disabled'||config.mpMode!=='disabled'||!config.allowIntegration||!config.enabled||config.emailMode!=='test')
    throw new Error('El arranque Sandbox requiere Flow de integración, correo de prueba y las otras pasarelas deshabilitadas.');
  const origin=new URL(config.origin);
  if(origin.protocol!=='https:'||['malfi.cl','www.malfi.cl','malfi-tienda.onrender.com'].includes(origin.hostname)||config.origin!==config.apiOrigin||config.origin!==config.flowPublicOrigin)
    throw new Error('Usa exclusivamente el origen HTTPS del servicio de pruebas.');
  if(!config.flowApiKey||!config.flowSecretKey||!env.RESEND_API_KEY||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_TEST_TO||''))
    throw new Error('Completa las claves de Flow Sandbox, Resend y EMAIL_TEST_TO en el servicio de pruebas.');
  const password=env.SANDBOX_ADMIN_PASSWORD;
  if(typeof password!=='string'||password.length<12||Buffer.byteLength(password,'utf8')>72)
    throw new Error('SANDBOX_ADMIN_PASSWORD debe tener al menos 12 caracteres y como máximo 72 bytes.');
  return {databaseName,email:env.EMAIL_TEST_TO.trim().toLowerCase(),password};
}

export async function bootstrapFlowSandbox(pool, config, env, flowClient) {
  const setup=assertFlowSandbox(config,env);
  const actual=(await pool.query('SELECT current_database() AS name')).rows[0]?.name;
  if(actual!==setup.databaseName)throw new Error('La conexión no corresponde a la base de pruebas esperada.');
  if(!flowClient)throw new Error('No se pudo preparar el cliente de Flow Sandbox.');
  // Read-only check against the Sandbox API before creating any fixture data.
  await flowClient.checkCredentials();
  await migrate(pool);
  const hash=await bcrypt.hash(setup.password,12),db=await pool.connect();
  try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(20261116,9100)');
    await db.query(`INSERT INTO admin_users(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING`,[setup.email,hash]);
    await db.query(`INSERT INTO store_settings(key,value) VALUES('business',$1) ON CONFLICT(key) DO NOTHING`,[{
      ...defaultStore,legalName:'MALFI · Pruebas Sandbox',rut:'11.111.111-1',legalAddress:'Dirección ficticia de pruebas, Chile',
      email:'tienda@example.test',phone:'+56900000000',preparationDays:2,policiesVersion:'flow-sandbox-v1'
    }]);
    for(const [name,price] of [['Prueba Flow · Vela de soja',30000],['Prueba Flow · Pieza de concreto',20000]])
      await db.query(`INSERT INTO products(name,description,price,category,stock)
        SELECT $1::text,'Producto ficticio para comprobar pagos Sandbox. No corresponde a una venta real.',$2::integer,$3::text,20
        WHERE NOT EXISTS(SELECT 1 FROM products WHERE name=$1)`,[name,price,price===30000?'Velas de soja':'Decoración de concreto']);
    await db.query(`INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,delivery_days_min,delivery_days_max,santiago_coverage,active,verified_at,rate_scope)
      VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,1,3,TRUE,TRUE,now(),'comuna')
      ON CONFLICT(lower(trim(region)),lower(trim(comuna))) DO UPDATE SET
        carrier=excluded.carrier,price_clp=excluded.price_clp,
        delivery_days_min=excluded.delivery_days_min,delivery_days_max=excluded.delivery_days_max,
        santiago_coverage=TRUE,active=TRUE,verified_at=excluded.verified_at,updated_at=now()
      WHERE shipping_rates_comunas.verified_at IS NULL AND shipping_rates_comunas.active=FALSE
        AND shipping_rates_comunas.delivery_days_min IS NULL AND shipping_rates_comunas.delivery_days_max IS NULL
        AND shipping_rates_comunas.carrier='Paket' AND shipping_rates_comunas.price_clp=3000`);
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
