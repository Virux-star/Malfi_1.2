import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { mpReturnState, applyMpPayment, readCanonicalMpPayment } from '../services/mercadoPago.js';
import { startPayment, releaseExpiredOrders } from '../services/payments.js';
import { sendEmailsOnce } from '../services/commerceWorker.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('Mercado Pago: checkout, notificaciones y stock con PostgreSQL real y API simulada',{skip:!databaseUrl},async t=>{
  assert.match(new URL(databaseUrl).pathname,/(?:test|qa)/i);
  const pool=new pg.Pool({connectionString:databaseUrl});let server;
  process.env.SESSION_SECRET='mercadopago-qa-session-000000000000000000000000';
  const config={production:false,origin:'http://localhost:5173',apiOrigin:'http://localhost:3000',mode:'integration',enabled:true,emailMode:'disabled',secret:process.env.SESSION_SECRET,
    mpMode:'integration',mpAccessToken:'PRIVATE-TEST-TOKEN',mpWebhookSecret:'test-webhook-secret-0000000000000000',mpCollectorId:'123456',mpPublicOrigin:'https://malfi-qa.example.test'};
  let preferenceCount=0,paymentCount=600000,version=0,lostResponse=false,realSeller=false;
  const preferences=new Map(),payments=new Map(),merchants=new Map();
  const stamp=()=>new Date(Date.now()+(++version)*1000).toISOString();
  const mp={
    getSeller:async()=>({id:123456,site_id:'MLC',tags:realSeller?['normal']:['normal','test_user']}),
    createPreference:async body=>{const id=`pref_${++preferenceCount}_${randomUUID()}`;const p={...structuredClone(body),id,collector_id:123456,init_point:`https://www.mercadopago.cl/checkout/v1/redirect?pref_id=${id}`};preferences.set(id,p);await new Promise(r=>setTimeout(r,25));if(lostResponse){lostResponse=false;throw new Error('Response lost after create');}return structuredClone(p);},
    getPreference:async id=>{if(!preferences.has(id))throw new Error('Not found');return structuredClone(preferences.get(id));},
    getPayment:async id=>{if(!payments.has(String(id)))throw new Error('Not found');return structuredClone(payments.get(String(id)));},
    getMerchantOrder:async id=>{if(!merchants.has(String(id)))throw new Error('Not found');return structuredClone(merchants.get(String(id)));},
    searchPayments:async(ref,offset=0)=>{const found=[...payments.values()].filter(p=>p.external_reference===ref);return {results:found.slice(offset,offset+50).map(p=>({id:p.id,external_reference:ref})),paging:{total:found.length,offset,limit:50}};}
  };
  function addPayment(pref,status='approved') {
    const id=String(++paymentCount),merchantId=String(paymentCount+1000000),date=stamp();
    const amount=pref.items.reduce((n,i)=>n+i.quantity*i.unit_price,0);
    const p={id:Number(id),external_reference:pref.external_reference,collector_id:123456,currency_id:'CLP',live_mode:false,transaction_amount:amount,transaction_amount_refunded:0,
      status,status_detail:status==='approved'?'accredited':status==='rejected'?'cc_rejected_other_reason':'pending_contingency',captured:true,
      payment_method_id:'visa',payment_type_id:'credit_card',card:{last_four_digits:'1111'},date_approved:status==='approved'?date:null,date_last_updated:date,
      order:{id:merchantId,type:'mercadopago'},metadata:pref.metadata};
    payments.set(id,p);merchants.set(merchantId,{id:Number(merchantId),preference_id:pref.id,external_reference:pref.external_reference,collector:{id:123456},site_id:'MLC',payments:[{id:Number(id)}]});return p;
  }
  const updatePayment=(p,status)=>Object.assign(p,{status,status_detail:status==='approved'?'accredited':status==='rejected'?'cc_rejected_other_reason':'pending_contingency',date_approved:status==='approved'?stamp():p.date_approved,date_last_updated:stamp()});
  try {
    await migrate(pool);await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO products(name,description,price,category,stock) VALUES('Vela QA','Cera de soja',10000,'Velas de soja',50)");
    await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Metropolitana de Santiago','Las Condes','Paket',3500,TRUE,1,3,TRUE,now())");
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)",[{legalName:'Pruebas MP',rut:'76.123.456-0',legalAddress:'Dirección ficticia',email:'store@example.test',phone:'+56912345678',preparationDays:2,policiesVersion:'mp-qa-v1',returnsInstructions:'Contactar a pruebas'}]);
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)',['admin@example.test',await bcrypt.hash('Test-password-123456',4)]);
    server=createApp({pool,config,webpayClient:null,mercadoPagoClient:mp}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(path,{method,body,token,key,cookie,headers={},origin=config.origin}={}) {
      const r=await fetch(base+path,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...(key?{'Idempotency-Key':key}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
      return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
    }
    const payload=()=>({customer:{fullName:'Cliente de prueba',email:'customer@example.test',phone:'+56912345678',region:'Metropolitana de Santiago',comuna:'Las Condes',address:'Dirección QA 123',reference:''},items:[{id:1,quantity:1}],expectedTotal:13500,acceptTerms:true,termsVersion:'mp-qa-v1',paymentProvider:'mercadopago'});
    async function order(){const r=await request('/api/orders',{body:payload(),key:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
    const checkout=async o=>(await pool.query('SELECT * FROM mercadopago_checkouts WHERE order_id=$1',[o.orderId])).rows[0];
    const readOrder=async o=>(await request(`/api/orders/${o.orderId}`,{token:o.accessToken})).data;
    const pay=o=>request(`/api/orders/${o.orderId}/pay`,{method:'POST',token:o.accessToken});
    async function webhook(p,{bodyStatus='approved',validSignature=true,omitOrigin=true}={}) {
      const id=String(p.id),ts=String(Math.floor(Date.now()/1000)),requestId=randomUUID();
      const signature=createHmac('sha256',config.mpWebhookSecret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
      return request(`/api/payments/mercadopago/webhook?data.id=${id}&type=payment`,{body:{type:'payment',data:{id},status:bodyStatus},origin:omitOrigin?null:config.origin,headers:{'x-request-id':requestId,'x-signature':`ts=${ts},v1=${validSignature?signature:'0'.repeat(64)}`}});
    }
    const product=async()=>(await pool.query('SELECT stock,reserved_stock FROM products WHERE id=1')).rows[0];
    let first,firstCheckout,firstPayment,adminCookie,lostOrder;
    await t.test('ofrece ambas opciones y no expone credenciales al navegador',async()=>{
      const r=await request('/api/store');assert.equal(r.status,200);assert.deepEqual(r.data.paymentProviders.map(p=>p.id),['webpay','mercadopago']);assert.equal(JSON.stringify(r.data).includes('PRIVATE-TEST-TOKEN'),false);assert.equal(JSON.stringify(r.data).includes(config.mpWebhookSecret),false);
      const login=await request('/api/admin/login',{body:{email:'admin@example.test',password:'Test-password-123456'}});adminCookie=login.headers.get('set-cookie').split(';')[0];
    });
    await t.test('idempotencia, total y medio elegido quedan fijos por pedido',async()=>{
      const key=randomUUID(),body=payload();const [a,b]=await Promise.all([request('/api/orders',{body,key}),request('/api/orders',{body,key})]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.orderId,b.data.orderId);first=a.data;
      assert.equal((await request('/api/orders',{body:{...body,paymentProvider:'webpay'},key})).status,409);
      assert.equal((await readOrder(first)).paymentProvider,'mercadopago');assert.deepEqual(await product(),{stock:50,reserved_stock:1});
      assert.equal((await request('/api/orders',{body:{...body,paymentProvider:'fake'},key:randomUUID()})).status,400);
    });
    await t.test('doble clic al pagar crea una sola preferencia y no permite saltar a Webpay',async()=>{
      const before=preferenceCount;const [a,b]=await Promise.all([pay(first),pay(first)]);assert.ok([a,b].some(r=>r.status===200));assert.equal(preferenceCount,before+1);firstCheckout=await checkout(first);
      const pref=preferences.get(firstCheckout.preference_id);assert.equal(pref.items.reduce((n,i)=>n+i.quantity*i.unit_price,0),13500);assert.equal(pref.expires,true);assert.ok(pref.back_urls.success.startsWith(config.mpPublicOrigin));assert.ok(!pref.back_urls.success.includes('localhost'));assert.match(pref.notification_url,/\/api\/payments\/mercadopago\/webhook$/);
      await assert.rejects(()=>startPayment(pool,{create:async()=>{throw new Error('Must not call');}},config,first.orderId));
      assert.equal((await pay(first)).data.url,pref.init_point);assert.equal(preferenceCount,before+1);
    });
    await t.test('webhook inválido y retorno falsificado no autorizan la compra',async()=>{
      firstPayment=addPayment(preferences.get(firstCheckout.preference_id),'pending');
      assert.equal((await webhook(firstPayment,{validSignature:false})).status,401);
      const fake=await request(`/api/payments/mercadopago/return?state=${'0'.repeat(64)}&status=approved&payment_id=${firstPayment.id}`);assert.equal(fake.status,303);assert.ok(!fake.headers.get('location').includes('#token='));
      assert.equal((await readOrder(first)).paymentStatus,'pending');assert.equal((await product()).stock,50);
    });
    await t.test('un estado approved enviado en el cuerpo no reemplaza la consulta de la API',async()=>{
      assert.equal((await webhook(firstPayment)).status,200);const o=await readOrder(first);assert.equal(o.paymentStatus,'pending');assert.equal(o.canPay,false);assert.equal((await product()).stock,50);
    });
    await t.test('notificaciones simultáneas confirman stock y correos una sola vez',async()=>{
      updatePayment(firstPayment,'approved');const [a,b]=await Promise.all([webhook(firstPayment),webhook(firstPayment)]);assert.equal(a.status,200);assert.equal(b.status,200);
      const o=await readOrder(first);assert.equal(o.paymentStatus,'paid');assert.equal(o.payment.payment_id,String(firstPayment.id));assert.equal(o.payment.card_last4,'1111');assert.equal(o.canPay,false);assert.deepEqual(await product(),{stock:49,reserved_stock:0});
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE order_id=$1',[first.orderId])).rows[0].n,2);assert.equal((await pay(first)).status,409);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE order_id=$1 AND template_version=2',[first.orderId])).rows[0].n,2);
    });
    await t.test('retorno auténtico restaura el enlace privado y administración consulta Mercado Pago',async()=>{
      const r=await request(`/api/payments/mercadopago/return?state=${mpReturnState(firstCheckout.id,config)}&payment_id=${firstPayment.id}&status=rejected`);assert.equal(r.status,303);assert.match(r.headers.get('location'),new RegExp(`/pedido/${first.orderId}#token=${first.accessToken}`));
      const paymentList=await request(`/api/admin/orders/${first.orderId}/payments`,{cookie:adminCookie});assert.equal(paymentList.data[0].provider,'mercadopago');assert.equal(paymentList.data[0].payment_id,String(firstPayment.id));
      const review=await request(`/api/admin/orders/${first.orderId}/reconcile`,{method:'POST',cookie:adminCookie});assert.equal(review.data.outcome,'paid');assert.equal((await product()).stock,49);
    });
    await t.test('se rechazan vendedor, moneda, ambiente, importe y preferencia ajenos',async()=>{
      const o=await order();assert.equal((await pay(o)).status,200);const c=await checkout(o),p=addPayment(preferences.get(c.preference_id));
      for(const [field,value] of Object.entries({collector_id:999,currency_id:'ARS',live_mode:true,transaction_amount:1})) {
        const prior=p[field];p[field]=value;assert.equal((await webhook(p)).status,500,field);p[field]=prior;assert.equal((await readOrder(o)).paymentStatus,'pending');
      }
      const merchant=merchants.get(String(p.order.id)),prior=merchant.preference_id;merchant.preference_id='wrong-preference';assert.equal((await webhook(p)).status,500);merchant.preference_id=prior;
      assert.equal((await webhook(p)).status,200);assert.equal((await readOrder(o)).paymentStatus,'paid');
    });
    await t.test('el rechazo conserva la reserva y reutiliza la misma preferencia',async()=>{
      const o=await order();await pay(o);const c=await checkout(o),p=addPayment(preferences.get(c.preference_id),'rejected');assert.equal((await webhook(p)).status,200);
      const current=await readOrder(o);assert.equal(current.paymentStatus,'pending');assert.equal(current.payment.state,'failed');assert.equal(current.canPay,true);
      const before=preferenceCount;assert.equal((await pay(o)).status,200);assert.equal(preferenceCount,before);
      const forged=await request(`/api/payments/mercadopago/return?state=${mpReturnState(c.id,config)}&payment_id=${firstPayment.id}&status=approved`);assert.equal(forged.status,303);assert.equal((await readOrder(o)).paymentStatus,'pending');
    });
    await t.test('una creación con respuesta perdida se concilia sin crear otra preferencia',async()=>{
      lostOrder=await order();lostResponse=true;const count=preferenceCount;assert.equal((await pay(lostOrder)).status,502);assert.equal((await pay(lostOrder)).status,409);assert.equal(preferenceCount,count+1);
      const c=await checkout(lostOrder);assert.equal(c.preference_id,null);const pref=[...preferences.values()].find(p=>p.external_reference===c.external_reference);const p=addPayment(pref);p.transaction_details={total_paid_amount:p.transaction_amount+500};
      assert.equal((await webhook(p)).status,200);assert.equal((await checkout(lostOrder)).preference_id,pref.id);assert.equal((await readOrder(lostOrder)).paymentStatus,'paid');
    });
    await t.test('expirar el carrito no libera un checkout potencialmente cobrable',async()=>{
      const o=await order();await pay(o);await pool.query("UPDATE orders SET expires_at=now()-interval '2 minutes' WHERE id=$1",[o.orderId]);await releaseExpiredOrders(pool);
      assert.equal((await pool.query('SELECT inventory_reserved FROM orders WHERE id=$1',[o.orderId])).rows[0].inventory_reserved,true);
      assert.equal((await request(`/api/admin/orders/${o.orderId}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'cancelled'}})).status,409);
    });
    await t.test('credenciales de una cuenta real se bloquean antes de crear una preferencia de prueba',async()=>{
      const o=await order(),before=preferenceCount;realSeller=true;assert.equal((await pay(o)).status,503);realSeller=false;assert.equal(preferenceCount,before);assert.equal(await checkout(o),undefined);
    });
    await t.test('otra autorización del mismo checkout se señala sin descontar otra vez',async()=>{
      const stock=await product();const duplicate=addPayment(preferences.get(firstCheckout.preference_id));assert.equal((await webhook(duplicate)).status,200);assert.deepEqual(await product(),stock);
      const o=await readOrder(first);assert.equal(o.requiresPaymentReview,true);assert.equal(o.payment.payment_id,String(firstPayment.id));
    });
    await t.test('reembolso y notificación antigua no reponen ni descuentan inventario',async()=>{
      const stale=await readCanonicalMpPayment(pool,mp,config,String(firstPayment.id));const stock=await product();updatePayment(firstPayment,'refunded');firstPayment.transaction_amount_refunded=13500;assert.equal((await webhook(firstPayment)).status,200);
      assert.equal((await readOrder(first)).paymentStatus,'refunded');assert.deepEqual(await product(),stock);
      await applyMpPayment(pool,stale);assert.equal((await readOrder(first)).paymentStatus,'refunded');assert.equal((await pool.query('SELECT provider_status FROM mercadopago_payments WHERE payment_id=$1',[String(firstPayment.id)])).rows[0].provider_status,'refunded');
    });
    await t.test('los correos productivos de Mercado Pago funcionan con Webpay desactivado',async()=>{
      await pool.query("UPDATE orders SET payment_mode='production' WHERE id=$1",[lostOrder.orderId]);process.env.ADMIN_EMAIL='admin@example.test';process.env.EMAIL_FROM='MALFI <sales@example.test>';let sent=0;
      const provider={emails:{send:async(msg,opts)=>{sent++;assert.ok(opts.idempotencyKey.startsWith('malfi-production-'));return {data:{id:randomUUID()}};}}};
      await sendEmailsOnce(pool,{...config,mode:'disabled',mpMode:'production',emailMode:'production'},provider);assert.equal(sent,2);
    });
  }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});
