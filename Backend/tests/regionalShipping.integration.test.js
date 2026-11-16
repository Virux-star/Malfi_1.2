import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { communesByRegion, paketCommunes, santiagoRegion, destination } from '../config/shipping.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('el catálogo territorial mantiene regiones, comunas y cobertura de Santiago coherentes',()=>{
  assert.equal(Object.keys(communesByRegion).length,16);
  assert.equal(Object.values(communesByRegion).flat().length,346);
  assert.equal(new Set(paketCommunes).size,34);
  assert.ok(paketCommunes.every(c=>communesByRegion[santiagoRegion].includes(c)));
  assert.deepEqual(destination(' metropolitana de santiago ',' nunoa '),{region:santiagoRegion,comuna:'Ñuñoa'});
  assert.equal(destination('Valparaíso','Las Condes'),null);
});

test('tarifas regionales Blue Express y precio único Paket con PostgreSQL real', {skip:!databaseUrl},async t=>{
  assert.match(new URL(databaseUrl).pathname,/(?:test|qa)/i);
  const pool=new pg.Pool({connectionString:databaseUrl});let server,preference;
  process.env.SESSION_SECRET='regional-shipping-qa-000000000000000000000';
  const config={production:false,origin:'http://localhost:5173',apiOrigin:'http://localhost:3000',mode:'disabled',enabled:true,emailMode:'disabled',secret:process.env.SESSION_SECRET,
    mpMode:'integration',mpAccessToken:'PRIVATE-TEST-TOKEN',mpWebhookSecret:'qa-shipping-webhook-secret',mpCollectorId:'123456',mpPublicOrigin:'https://malfi-qa.example.test'};
  const mp={getSeller:async()=>({id:123456,site_id:'MLC',tags:['test_user']}),createPreference:async body=>(preference={...body,id:'pref_regional_qa',collector_id:123456,init_point:'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref_regional_qa'})};
  try{
    await migrate(pool);await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO products(name,description,price,category,stock) VALUES('Vela QA','Vela de soja',10000,'Velas de soja',20)");
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)",[{legalName:'Tienda QA',rut:'76.123.456-0',legalAddress:'Dirección QA',email:'store@example.test',phone:'+56912345678',preparationDays:2,policiesVersion:'shipping-qa-v1',returnsInstructions:'Contactar a la tienda'}]);
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)',['admin@example.test',await bcrypt.hash('Test-password-123456',4)]);
    server=createApp({pool,config,webpayClient:null,mercadoPagoClient:mp}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(path,{body,method=body?'POST':'GET',cookie,token,key}={}){
      const r=await fetch(base+path,{method,headers:{Origin:config.origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});
      return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
    }
    const regional=(overrides={})=>({region:'Valparaíso',carrier:'Blue Express',rateScope:'region',price:4500,daysMin:2,daysMax:4,active:true,confirmedRealRate:true,...overrides});
    const paket=(overrides={})=>({daysMin:1,daysMax:3,active:true,confirmedRealRate:true,...overrides});
    const quote=(region,comuna)=>request('/api/shipping/quote?'+new URLSearchParams({region,comuna}));
    const body=(region,comuna,total)=>({customer:{fullName:'Cliente QA',email:'customer@example.test',phone:'+56912345678',region,comuna,address:'Dirección QA 123'},items:[{id:1,quantity:1}],expectedTotal:total,acceptTerms:true,termsVersion:'shipping-qa-v1',paymentProvider:'mercadopago'});
    let cookie,order,checkoutKey;
    await t.test('protege la administración y no inventa precios para regiones sin configurar',async()=>{
      assert.equal((await request('/api/admin/shipping/settings')).status,401);
      assert.equal((await request('/api/admin/shipping/paket',{method:'PUT',body:paket()})).status,401);
      assert.deepEqual((await request('/api/shipping/destinations')).data,[]);
      assert.equal((await quote('Coquimbo','La Serena')).status,409);
      const login=await request('/api/admin/login',{body:{email:'admin@example.test',password:'Test-password-123456'}});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
    });
    await t.test('valida y guarda una sola tarifa regional sin exigir comuna',async()=>{
      for(const invalid of [{price:''},{price:-1},{daysMin:0},{daysMax:1},{confirmedRealRate:false},{region:'No existe'},{carrier:'Paket'}])assert.equal((await request('/api/admin/shipping',{cookie,body:regional(invalid)})).status,400,JSON.stringify(invalid));
      const [a,b]=await Promise.all([request('/api/admin/shipping',{cookie,body:regional()}),request('/api/admin/shipping',{cookie,body:regional()})]);assert.equal(a.status,200);assert.equal(b.status,200);
      const saved=(await pool.query("SELECT * FROM shipping_rates_comunas WHERE rate_scope='region'")).rows;assert.equal(saved.length,1);assert.equal(saved[0].comuna,'');assert.equal(saved[0].price_clp,4500);
    });
    await t.test('un precio regional cubre comunas distintas y valida que pertenezcan a la región',async()=>{
      const destinations=(await request('/api/shipping/destinations')).data;
      assert.equal(destinations.length,communesByRegion['Valparaíso'].length);
      assert.ok(destinations.every(r=>r.carrier==='Blue Express'&&r.price_clp===4500));
      for(const comuna of ['Valparaíso','Viña del Mar','Los Andes']){const r=await quote('Valparaíso',comuna);assert.equal(r.status,200);assert.equal(r.data.shippingCost,4500);}
      assert.equal((await quote('Valparaíso','Las Condes')).status,409);
    });
    await t.test('la tarifa regional sustituye las antiguas y deshabilitarla bloquea el destino',async()=>{
      await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Valparaíso','Valparaíso','Blue Express',9000,TRUE,1,3,FALSE,now()),('Valparaíso','Viña del Mar','Blue Express',8000,TRUE,1,3,FALSE,now())");
      assert.equal((await quote('Valparaíso','Valparaíso')).data.shippingCost,4500);
      assert.equal((await request('/api/admin/shipping',{cookie,body:regional({active:false})})).status,200);
      assert.equal((await quote('Valparaíso','Valparaíso')).status,409);
      assert.deepEqual((await request('/api/shipping/destinations')).data,[]);
      assert.equal((await request('/api/admin/shipping',{cookie,body:regional()})).status,200);
      assert.equal((await pool.query("SELECT price_clp FROM shipping_rates_comunas WHERE region='Valparaíso' AND comuna='Valparaíso'")).rows[0].price_clp,9000);
    });
    await t.test('un único ajuste habilita Paket a $3.000 para las 34 comunas de Santiago',async()=>{
      assert.equal((await request('/api/admin/shipping/paket',{cookie,method:'PUT',body:paket({confirmedRealRate:false})})).status,400);
      assert.equal((await request('/api/admin/shipping/paket',{cookie,method:'PUT',body:paket({daysMin:0})})).status,400);
      assert.equal((await request('/api/admin/shipping/paket',{cookie,method:'PUT',body:paket({price:1})})).status,200);
      const rows=(await pool.query("SELECT * FROM shipping_rates_comunas WHERE carrier='Paket'")).rows;assert.equal(rows.length,34);assert.ok(rows.every(r=>r.price_clp===3000));
      const settings=(await request('/api/admin/shipping/settings',{cookie})).data;assert.equal(settings.paket.active,true);assert.equal(settings.paket.price,3000);assert.equal(settings.paket.comunas.length,34);
      for(const comuna of paketCommunes){const q=await quote(santiagoRegion,comuna);assert.equal(q.status,200,comuna);assert.equal(q.data.carrier,'Paket');assert.equal(q.data.shippingCost,3000);}
    });
    await t.test('la tarifa de Blue Express en RM se usa fuera de Santiago y Paket conserva prioridad',async()=>{
      assert.equal((await request('/api/admin/shipping',{cookie,body:regional({region:santiagoRegion,price:6000})})).status,200);
      for(const comuna of ['Melipilla','Colina','Lampa']){const q=await quote(santiagoRegion,comuna);assert.equal(q.status,200);assert.equal(q.data.carrier,'Blue Express');assert.equal(q.data.shippingCost,6000);}
      for(const comuna of ['Las Condes','Ñuñoa','Puente Alto']){const q=await quote(santiagoRegion,comuna);assert.equal(q.data.carrier,'Paket');assert.equal(q.data.shippingCost,3000);}
      const q=await quote('metropolitana de santiago','nunoa');assert.equal(q.data.comuna,'Ñuñoa');assert.equal(q.data.shippingCost,3000);
    });
    await t.test('el servidor fija transportista y monto del pedido y exige revisar cambios de tarifa',async()=>{
      assert.equal((await request('/api/orders',{key:randomUUID(),body:{...body(santiagoRegion,'Las Condes',10000),shippingCost:0,carrier:'Blue Express'}})).status,409);
      checkoutKey=randomUUID();const r=await request('/api/orders',{key:checkoutKey,body:body('Valparaíso','Viña del Mar',14500)});assert.equal(r.status,201,JSON.stringify(r.data));order=r.data;
      const o=(await pool.query('SELECT * FROM orders WHERE id=$1',[order.orderId])).rows[0];assert.equal(o.carrier,'Blue Express');assert.equal(o.shipping_clp,4500);assert.equal(o.delivery_days_min,4);assert.equal(o.delivery_days_max,6);
      assert.equal((await request('/api/admin/shipping',{cookie,body:regional({price:5000})})).status,200);
      const retry=await request('/api/orders',{key:checkoutKey,body:body('Valparaíso','Viña del Mar',14500)});assert.equal(retry.status,201);assert.equal(retry.data.orderId,order.orderId);assert.equal(retry.data.total,14500);
      assert.equal((await request('/api/orders',{key:randomUUID(),body:body('Valparaíso','Viña del Mar',14500)})).status,409);
      assert.equal((await request('/api/orders',{key:randomUUID(),body:body('Valparaíso','Viña del Mar',15000)})).status,201);
      const canonical=await request('/api/orders',{key:randomUUID(),body:body('metropolitana de santiago',' nunoa ',13000)});assert.equal(canonical.status,201);assert.equal(canonical.data.carrier,'Paket');
      assert.equal((await pool.query('SELECT shipping_comuna FROM orders WHERE id=$1',[canonical.data.orderId])).rows[0].shipping_comuna,'Ñuñoa');
    });
    await t.test('Mercado Pago y el comprobante mantienen la tarifa guardada aunque cambie la región',async()=>{
      const r=await request(`/api/orders/${order.orderId}/pay`,{method:'POST',token:order.accessToken});assert.equal(r.status,200);
      const shipping=preference.items.find(i=>i.id==='shipping');assert.equal(shipping.unit_price,4500);assert.equal(preference.items.reduce((n,i)=>n+i.unit_price*i.quantity,0),14500);
      const saved=await request(`/api/orders/${order.orderId}`,{token:order.accessToken});assert.equal(saved.data.shipping,4500);assert.equal(saved.data.total,14500);
    });
    await t.test('deshabilitar Paket no lo reemplaza por Blue Express y conserva retiro gratuito',async()=>{
      assert.equal((await request('/api/admin/shipping/paket',{cookie,method:'PUT',body:paket({active:false})})).status,200);
      assert.equal((await quote(santiagoRegion,'Las Condes')).status,409);
      assert.equal((await quote(santiagoRegion,'Melipilla')).data.shippingCost,6000);
      const pickup={...body('', '',10000),deliveryMethod:'pickup',customer:{fullName:'Cliente QA',email:'customer@example.test',phone:'+56912345678'}};
      const r=await request('/api/orders',{key:randomUUID(),body:pickup});assert.equal(r.status,201);assert.equal(r.data.deliveryMethod,'pickup');assert.equal(r.data.total,10000);
      const o=(await pool.query('SELECT shipping_clp FROM orders WHERE id=$1',[r.data.orderId])).rows[0];assert.equal(o.shipping_clp,0);
    });
  }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});
