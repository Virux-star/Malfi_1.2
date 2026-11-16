import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { pickupLocation } from '../config/fulfillment.js';
import { readCanonicalMpPayment, applyMpPayment } from '../services/mercadoPago.js';
import { sendEmailsOnce } from '../services/commerceWorker.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('retiro en tienda: entrega, pagos, correos y administración', {skip:!databaseUrl}, async t=>{
  assert.match(new URL(databaseUrl).pathname,/(?:test|qa)/i);
  const pool=new pg.Pool({connectionString:databaseUrl});let server;
  process.env.SESSION_SECRET='pickup-test-session-secret-000000000000000000';
  const config={production:false,origin:'http://localhost:5173',apiOrigin:'http://localhost:3000',mode:'integration',enabled:true,emailMode:'disabled',secret:process.env.SESSION_SECRET,
    mpMode:'integration',mpAccessToken:'PRIVATE-TEST-TOKEN',mpWebhookSecret:'pickup-webhook-test-secret',mpCollectorId:'123456',mpPublicOrigin:'https://malfi-qa.example.test'};
  const banks=new Map();let preference,payment,merchant;
  const tx={
    async create(buy_order,session_id,amount){const token=randomBytes(32).toString('hex');banks.set(token,{buy_order,session_id,amount});return {token,url:'https://webpay3gint.transbank.cl/webpayserver/initTransaction'};},
    async commit(token){return {...banks.get(token),status:'AUTHORIZED',response_code:0,authorization_code:'123456',payment_type_code:'VD',card_detail:{card_number:'6623'},transaction_date:new Date().toISOString()};}
  };
  const mp={
    getSeller:async()=>({id:123456,site_id:'MLC',tags:['test_user']}),
    createPreference:async body=>(preference={...body,id:'pref_pickup_qa',collector_id:123456,init_point:'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref_pickup_qa'}),
    getPayment:async()=>structuredClone(payment),getMerchantOrder:async()=>structuredClone(merchant)
  };
  try {
    await migrate(pool);await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO products(name,description,price,category,stock) VALUES('Vela QA','Cera de soja',10000,'Velas de soja',20)");
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)",[{legalName:'Negocio QA',rut:'76.123.456-0',legalAddress:'Domicilio legal QA',email:'store@example.test',phone:'+56912345678',preparationDays:2,policiesVersion:'pickup-qa-v1',returnsInstructions:'Contactar al negocio'}]);
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)',['admin@example.test',await bcrypt.hash('Test-password-123456',4)]);
    server=createApp({pool,config,webpayClient:tx,mercadoPagoClient:mp}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(path,{body,method=body?'POST':'GET',key,token,cookie}={}) {
      const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:config.origin,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
      return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
    }
    const payload=()=>({deliveryMethod:'pickup',customer:{fullName:'Cliente QA',email:'customer@example.test',phone:'+56912345678'},items:[{id:1,quantity:1}],expectedTotal:10000,acceptTerms:true,termsVersion:'pickup-qa-v1'});
    const read=o=>request(`/api/orders/${o.orderId}`,{token:o.accessToken});
    let webpayOrder,mpOrder,shippingOrder,cookie;
    await t.test('ofrece retiro sin depender de tarifas de despacho',async()=>{
      const store=await request('/api/store');assert.equal(store.data.checkoutAvailable,true);assert.deepEqual(store.data.pickup,pickupLocation);
      assert.deepEqual((await request('/api/shipping/destinations')).data,[]);
      const r=await request('/api/orders',{body:payload(),key:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.data));webpayOrder=r.data;
      assert.equal(r.data.total,10000);assert.equal(r.data.deliveryMethod,'pickup');
      const o=(await read(webpayOrder)).data;assert.equal(o.shipping,0);assert.equal(o.pickupAddress,'Av. Américo Vespucio Sur 250, Las Condes');assert.equal(o.deliveryDaysMax,2);
      assert.equal((await request(`/api/orders/${webpayOrder.orderId}`)).status,404);
    });
    await t.test('valida modalidad y total, fija el punto de retiro y evita reservas duplicadas',async()=>{
      assert.equal((await request('/api/orders',{body:{...payload(),deliveryMethod:'fake'},key:randomUUID()})).status,400);
      assert.equal((await request('/api/orders',{body:{...payload(),expectedTotal:13000},key:randomUUID()})).status,409);
      const key=randomUUID(),body={...payload(),paymentProvider:'mercadopago',customer:{...payload().customer,address:'No es el punto de retiro',region:'Maule',comuna:'Otra',reference:'No guardar'}};
      const [a,b]=await Promise.all([request('/api/orders',{body,key}),request('/api/orders',{body,key})]);
      assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.orderId,b.data.orderId);mpOrder=a.data;
      assert.equal((await request('/api/orders',{body:{...body,deliveryMethod:'shipping'},key})).status,409);
      const saved=(await pool.query('SELECT * FROM orders WHERE id=$1',[mpOrder.orderId])).rows[0];
      assert.equal(saved.shipping_address,pickupLocation.address);assert.equal(saved.shipping_comuna,pickupLocation.comuna);assert.equal(saved.shipping_reference,null);
      assert.equal((await pool.query('SELECT reserved_stock FROM products WHERE id=1')).rows[0].reserved_stock,2);
    });
    await t.test('los despachos conservan su dirección, tarifa y modalidad por defecto',async()=>{
      const body={...payload(),customer:{...payload().customer,region:'Metropolitana de Santiago',comuna:'Las Condes',address:'Casa del cliente QA'}};delete body.deliveryMethod;body.expectedTotal=13000;
      assert.equal((await request('/api/orders',{body,key:randomUUID()})).status,409);
      await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,TRUE,1,3,TRUE,now())");
      const r=await request('/api/orders',{body,key:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.data));shippingOrder=r.data;
      const o=(await read(shippingOrder)).data;assert.equal(o.deliveryMethod,'shipping');assert.equal(o.shipping,3000);assert.equal(o.pickupAddress,null);
    });
    await t.test('Webpay confirma retiro por el subtotal y descuenta stock una sola vez',async()=>{
      const p=await request(`/api/orders/${webpayOrder.orderId}/pay`,{method:'POST',token:webpayOrder.accessToken});assert.equal(p.status,200);assert.equal(banks.get(p.data.token).amount,10000);
      for(let i=0;i<2;i++)assert.equal((await request('/api/payments/webpay/return',{body:{token_ws:p.data.token}})).status,303);
      assert.equal((await read(webpayOrder)).data.paymentStatus,'paid');assert.equal((await pool.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,19);
    });
    await t.test('Mercado Pago cobra solo productos y conserva la modalidad al confirmar',async()=>{
      assert.equal((await request(`/api/orders/${mpOrder.orderId}/pay`,{method:'POST',token:mpOrder.accessToken})).status,200);
      assert.equal(preference.items.length,1);assert.equal(preference.items[0].unit_price,10000);assert.ok(preference.items.every(i=>i.id!=='shipping'));
      const date=new Date().toISOString();
      payment={id:600001,external_reference:preference.external_reference,collector_id:123456,currency_id:'CLP',live_mode:false,transaction_amount:10000,transaction_amount_refunded:0,status:'approved',status_detail:'accredited',captured:true,payment_method_id:'visa',payment_type_id:'credit_card',card:{last_four_digits:'1111'},date_approved:date,date_last_updated:date,order:{id:'1600001',type:'mercadopago'},metadata:preference.metadata};
      merchant={id:1600001,preference_id:preference.id,external_reference:preference.external_reference,collector:{id:123456},site_id:'MLC',payments:[{id:600001}]};
      for(let i=0;i<2;i++)await applyMpPayment(pool,await readCanonicalMpPayment(pool,mp,config,'600001'));
      const o=(await read(mpOrder)).data;assert.equal(o.paymentStatus,'paid');assert.equal(o.deliveryMethod,'pickup');
      assert.equal((await pool.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,18);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE order_id=$1',[mpOrder.orderId])).rows[0].n,2);
    });
    await t.test('correo de cliente e interno informan retiro, dirección y costo cero',async()=>{
      process.env.EMAIL_TEST_TO='test@example.test';const sent=[];
      await sendEmailsOnce(pool,{...config,emailMode:'test'},{emails:{send:async message=>{sent.push(message);return {data:{id:randomUUID()}};}}});
      assert.equal(sent.length,4);
      for(const message of sent){assert.match(message.text,/Retiro en tienda: Sin costo/);assert.ok(message.html.includes(pickupLocation.address));assert.doesNotMatch(message.text,/Despacho \(/);if(message.attachments){const text=Buffer.from(message.attachments[0].content,'base64').toString('utf8');assert.ok(text.includes(pickupLocation.address));assert.ok(text.includes('Condiciones aceptadas'));}}
      await sendEmailsOnce(pool,{...config,emailMode:'test'},{emails:{send:async()=>{throw new Error('No reenviar');}}});
      assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE status='sent'")).rows[0].n,4);
    });
    await t.test('administración permite preparar, dejar listo y retirar; no permite envío ni tracking',async()=>{
      const login=await request('/api/admin/login',{body:{email:'admin@example.test',password:'Test-password-123456'}});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
      const status=(o,status)=>request(`/api/admin/orders/${o.orderId}/status`,{cookie,method:'PATCH',body:{status}});
      assert.equal((await status(shippingOrder,'ready_for_pickup')).status,409);
      assert.equal((await status(mpOrder,'ready_for_pickup')).status,409);
      assert.equal((await status(mpOrder,'preparing')).status,200);
      assert.equal((await status(mpOrder,'shipped')).status,409);
      assert.equal((await status(mpOrder,'delivered')).status,409);
      assert.equal((await request(`/api/admin/orders/${mpOrder.orderId}/tracking`,{cookie,method:'PATCH',body:{trackingNumber:'QA123'}})).status,409);
      assert.equal((await status(mpOrder,'ready_for_pickup')).status,200);assert.equal((await read(mpOrder)).data.status,'ready_for_pickup');
      const detail=await request(`/api/admin/orders/${mpOrder.orderId}`,{cookie});assert.equal(detail.data.delivery_method,'pickup');assert.equal(detail.data.shipping_address,pickupLocation.address);
      assert.equal((await status(mpOrder,'delivered')).status,200);assert.equal((await read(mpOrder)).data.status,'delivered');
      assert.equal((await status(shippingOrder,'preparing')).status,409);
    });
  } finally {if(server)await new Promise(r=>server.close(r));await pool.end();}
});
