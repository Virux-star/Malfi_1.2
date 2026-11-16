import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { assertFlowSandbox, bootstrapFlowSandbox } from '../services/flowSandbox.js';
import { migrate } from '../scripts/migrate.js';
import { shippingDestinations } from '../services/shipping.js';

const config={origin:'https://malfi-flow-pruebas.example.test',apiOrigin:'https://malfi-flow-pruebas.example.test',flowPublicOrigin:'https://malfi-flow-pruebas.example.test',
  flowMode:'integration',mode:'disabled',mpMode:'disabled',allowIntegration:true,enabled:true,emailMode:'test',flowApiKey:'qa-key',flowSecretKey:'qa-secret'};
const env={DATABASE_URL:'postgresql://qa:fake@localhost/malfi_flow_pruebas',FLOW_SANDBOX_SETUP:'true',RESEND_API_KEY:'qa-resend',EMAIL_TEST_TO:'qa@example.test',SANDBOX_ADMIN_PASSWORD:'Qa-password-123456'};

test('el arranque de pruebas exige un ambiente explícito y una base separada',()=>{
  assert.equal(assertFlowSandbox(config,env).databaseName,'malfi_flow_pruebas');
  for(const url of ['postgresql://qa:fake@localhost/malfi','postgresql://qa:fake@localhost/production','not-a-url'])
    assert.throws(()=>assertFlowSandbox(config,{...env,DATABASE_URL:url}),/base separada/);
  for(const change of [{flowMode:'production'},{mpMode:'production'},{mode:'integration'},{emailMode:'production'},{allowIntegration:false},{enabled:false}])
    assert.throws(()=>assertFlowSandbox({...config,...change},env),/arranque Sandbox/);
  assert.throws(()=>assertFlowSandbox(config,{...env,FLOW_SANDBOX_SETUP:'false'}));
  assert.throws(()=>assertFlowSandbox({...config,origin:'https://malfi.cl',apiOrigin:'https://malfi.cl',flowPublicOrigin:'https://malfi.cl'},env),/origen HTTPS/);
  assert.throws(()=>assertFlowSandbox(config,{...env,SANDBOX_ADMIN_PASSWORD:'short'}));
  assert.throws(()=>assertFlowSandbox(config,{...env,EMAIL_TEST_TO:''}));
});
test('una configuración productiva se rechaza antes de ejecutar consultas o llamadas Flow',async()=>{
  let called=0;
  await assert.rejects(()=>bootstrapFlowSandbox({query:async()=>{called++;}},config,{...env,DATABASE_URL:'postgresql://qa:fake@localhost/malfi'},{checkCredentials:async()=>{called++;}}));
  assert.equal(called,0);
  await assert.rejects(()=>bootstrapFlowSandbox({query:async()=>({rows:[{name:'malfi'}]})},config,env,{checkCredentials:async()=>{called++;}}),/conexión/);
  assert.equal(called,0);
});

const databaseUrl=process.env.TEST_DATABASE_URL;
test('crea fixtures idempotentes solo en la base QA y conserva sus cambios posteriores',{skip:!databaseUrl},async()=>{
  assert.match(new URL(databaseUrl).pathname,/(?:test|qa)/i);
  const pool=new pg.Pool({connectionString:databaseUrl});let checks=0;
  const localEnv={...env,DATABASE_URL:databaseUrl},flow={checkCredentials:async()=>{checks++;return true;}};
  try{
    await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,flow_checkouts,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    // Migration 007 leaves unverified placeholders on a newly created database.
    await pool.query(`INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,santiago_coverage,rate_scope)
      VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,FALSE,TRUE,'comuna')`);
    await bootstrapFlowSandbox(pool,config,localEnv,flow);
    const destinations=await shippingDestinations(pool);
    assert.equal(destinations.length,1);assert.equal(destinations[0].comuna,'Las Condes');assert.equal(destinations[0].price_clp,3000);
    const admin=(await pool.query('SELECT * FROM admin_users')).rows[0];
    assert.equal(admin.email,env.EMAIL_TEST_TO);assert.equal(await bcrypt.compare(env.SANDBOX_ADMIN_PASSWORD,admin.password_hash),true);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n,2);
    await pool.query('UPDATE products SET stock=18 WHERE id=1');
    await pool.query("UPDATE store_settings SET value=jsonb_set(value,'{phone}','\"+56911111111\"') WHERE key='business'");
    await pool.query('UPDATE shipping_rates_comunas SET active=FALSE');
    await bootstrapFlowSandbox(pool,config,{...localEnv,SANDBOX_ADMIN_PASSWORD:'Different-password-123'},flow);
    assert.equal(checks,2);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM admin_users')).rows[0].n,1);
    assert.equal((await pool.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,18);
    assert.equal((await pool.query("SELECT value->>'phone' AS phone FROM store_settings WHERE key='business'")).rows[0].phone,'+56911111111');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM shipping_rates_comunas')).rows[0].n,1);
    assert.deepEqual(await shippingDestinations(pool),[]);
    assert.equal((await pool.query('SELECT password_hash FROM admin_users')).rows[0].password_hash,admin.password_hash);
    await assert.rejects(()=>bootstrapFlowSandbox(pool,config,localEnv,{checkCredentials:async()=>{throw Error('bad sandbox credentials');}}));
    assert.equal((await pool.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,18);
  }finally{await pool.end();}
});
