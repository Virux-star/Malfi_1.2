import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { releaseExpiredOrders, reconcilePayment } from '../services/payments.js';
import { sendEmailsOnce } from '../services/commerceWorker.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('recorrido de compra y administración con PostgreSQL real y banco simulado', {skip:!databaseUrl},async t=>{
  const dbName=new URL(databaseUrl).pathname;
  assert.match(dbName,/(?:test|qa)/i,'Usa una base exclusiva de pruebas cuyo nombre contenga test o qa.');
  const pool=new pg.Pool({connectionString:databaseUrl});
  let server;
  process.env.SESSION_SECRET='test-session-secret-000000000000000000000000';
  const config={production:false,origin:'http://localhost:5173',apiOrigin:'http://localhost:3000',mode:'integration',enabled:true,emailMode:'disabled',secret:process.env.SESSION_SECRET};
  const banks=new Map();let creates=0,commits=0;
  const tx={
    async create(buy_order,session_id,amount){creates++;await new Promise(r=>setTimeout(r,30));const token=randomBytes(32).toString('hex');banks.set(token,{buy_order,session_id,amount,status:'INITIALIZED',response_code:null});return {token,url:'https://webpay3gint.transbank.cl/webpayserver/initTransaction'};},
    async commit(token){commits++;const bank=banks.get(token);Object.assign(bank,{status:'AUTHORIZED',response_code:0,authorization_code:'123456',payment_type_code:'VD',card_detail:{card_number:'6623'},transaction_date:new Date().toISOString()});return bank;},
    async status(token){if(!banks.has(token))throw new Error('Bank unavailable');return banks.get(token);}
  };
  try{
    await migrate(pool);await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO products(name,description,price,category,stock) VALUES('Vela de soja','Vela aromática de cera de soja',10000,'Velas de soja',20),('Pieza de concreto','Decoración',7000,'Decoración de concreto',1)");
    await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Metropolitana de Santiago','Las Condes','Paket',3500,TRUE,1,3,TRUE,now()),('Metropolitana de Santiago','Melipilla','Blue Express',6500,TRUE,3,5,FALSE,now())");
    const business={legalName:'Tienda de pruebas',rut:'76.123.456-0',legalAddress:'Dirección ficticia QA',email:'store@example.test',phone:'+56912345678',preparationDays:2,policiesVersion:'qa-v1',returnsInstructions:'Contactar al negocio'};
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)",[business]);
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)',['admin@example.test',await bcrypt.hash('Test-password-123456',4)]);
    server=createApp({pool,config,webpayClient:tx}).listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=async(path,{body,method=body?'POST':'GET',token,key,cookie,origin=config.origin,raw}={})=>{
      const r=await fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...(key?{'Idempotency-Key':key}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
      return {status:r.status,data:raw?await r.text():await r.json().catch(()=>null),headers:r.headers};
    };
    const payload=(id=1,quantity=1)=>({customer:{fullName:'Cliente QA',email:'customer@example.test',phone:'+56912345678',region:'Metropolitana de Santiago',comuna:'Las Condes',address:'Dirección QA 123',reference:''},items:[{id,quantity}],expectedTotal:(id===1?10000:7000)*quantity+3500,acceptTerms:true,termsVersion:'qa-v1'});
    let paidOrder,paidPayment,adminCookie;
    await t.test('bloquea orígenes ajenos y protege datos de administración',async()=>{
      assert.equal((await request('/api/orders',{body:payload(),key:randomUUID(),origin:'https://evil.test'})).status,403);
      assert.equal((await request('/api/admin/orders')).status,401);
      const r=await request('/api/admin/login',{body:{email:'admin@example.test',password:'Test-password-123456'}});assert.equal(r.status,200);adminCookie=r.headers.get('set-cookie').split(';')[0];
      assert.equal((await request('/api/admin/orders',{cookie:adminCookie})).status,200);
    });
    await t.test('cobertura por comuna, aceptación de términos y total verificado',async()=>{
      assert.equal((await request('/api/shipping/quote?region=Metropolitana%20de%20Santiago&comuna=Melipilla')).data.carrier,'Blue Express');
      assert.equal((await request('/api/shipping/quote?region=Metropolitana%20de%20Santiago&comuna=NoExiste')).status,409);
      assert.equal((await request('/api/orders',{body:{...payload(),acceptTerms:false},key:randomUUID()})).status,400);
      assert.equal((await request('/api/orders',{body:{...payload(),expectedTotal:1},key:randomUUID()})).status,409);
    });
    await t.test('doble clic crea un pedido y una sola reserva; el enlace es privado',async()=>{
      const key=randomUUID();const [a,b]=await Promise.all([request('/api/orders',{body:payload(),key}),request('/api/orders',{body:payload(),key})]);
      assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.orderId,b.data.orderId);paidOrder=a.data;
      assert.equal((await pool.query('SELECT reserved_stock FROM products WHERE id=1')).rows[0].reserved_stock,1);
      assert.equal((await request(`/api/orders/${paidOrder.orderId}`)).status,404);
      assert.equal((await request(`/api/orders/${paidOrder.orderId}`,{token:'a'.repeat(64)})).status,404);
      assert.equal((await request('/api/orders',{body:payload(1,2),key})).status,409);
    });
    await t.test('inicios simultáneos y callbacks duplicados no duplican cobros ni inventario',async()=>{
      const path=`/api/orders/${paidOrder.orderId}/pay`,token=paidOrder.accessToken;
      const [a,b]=await Promise.all([request(path,{method:'POST',token}),request(path,{method:'POST',token})]);
      assert.equal(creates,1);paidPayment=(a.status===200?a:b).data;assert.ok(paidPayment.token);
      const [c,d]=await Promise.all([request('/api/payments/webpay/return',{body:{token_ws:paidPayment.token}}),request('/api/payments/webpay/return',{body:{token_ws:paidPayment.token}})]);
      assert.equal(c.status,303);assert.equal(d.status,303);assert.equal(commits,1);
      assert.match(c.headers.get('location'),new RegExp(`/pedido/${paidOrder.orderId}#token=`));
      const o=(await request(`/api/orders/${paidOrder.orderId}`,{token})).data;assert.equal(o.paymentStatus,'paid');assert.equal(o.canPay,false);assert.equal(o.payment.card_last4,'6623');
      const product=(await pool.query('SELECT stock,reserved_stock FROM products WHERE id=1')).rows[0];assert.deepEqual(product,{stock:19,reserved_stock:0});
      assert.equal((await request(path,{method:'POST',token})).status,409);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox')).rows[0].n,2);
    });
    await t.test('última unidad concurrente solo se reserva una vez',async()=>{
      const [a,b]=await Promise.all([request('/api/orders',{body:payload(2),key:randomUUID()}),request('/api/orders',{body:payload(2),key:randomUUID()})]);
      assert.deepEqual([a.status,b.status].sort(),[201,409]);
    });
    await t.test('expiración libera pedidos sin pago y conserva pagos inciertos',async()=>{
      const o=(await request('/api/orders',{body:payload(),key:randomUUID()})).data;
      await pool.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[o.orderId]);await releaseExpiredOrders(pool);
      assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[o.orderId])).rows[0].status,'cancelled');
      const uncertain=(await request('/api/orders',{body:payload(),key:randomUUID()})).data;
      await request(`/api/orders/${uncertain.orderId}/pay`,{method:'POST',token:uncertain.accessToken});
      await pool.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",[uncertain.orderId]);await releaseExpiredOrders(pool);
      assert.equal((await pool.query('SELECT inventory_reserved FROM orders WHERE id=$1',[uncertain.orderId])).rows[0].inventory_reserved,true);
      assert.equal((await request(`/api/admin/orders/${uncertain.orderId}/status`,{method:'PATCH',cookie:adminCookie,body:{status:'cancelled'}})).status,409);
    });
    await t.test('conciliación recupera autorización tras perder retorno y falla con monto ajeno',async()=>{
      const o=(await request('/api/orders',{body:payload(),key:randomUUID()})).data;
      const p=(await request(`/api/orders/${o.orderId}/pay`,{method:'POST',token:o.accessToken})).data;
      const a=(await pool.query('SELECT * FROM webpay_payments WHERE token_ws=$1',[p.token])).rows[0];
      const b=await tx.commit(p.token);const amount=b.amount;b.amount=1;
      await assert.rejects(()=>reconcilePayment(pool,tx,config,a));b.amount=amount;
      assert.equal(await reconcilePayment(pool,tx,config,a),'paid');assert.equal(await reconcilePayment(pool,tx,config,a),'paid');
    });
    await t.test('rechazo definitivo permite un nuevo intento y cancelación sin cobro no confirma venta',async()=>{
      const o=(await request('/api/orders',{body:payload(),key:randomUUID()})).data;
      const p=(await request(`/api/orders/${o.orderId}/pay`,{method:'POST',token:o.accessToken})).data;
      const a=(await pool.query('SELECT * FROM webpay_payments WHERE token_ws=$1',[p.token])).rows[0];
      banks.get(p.token).status='FAILED';banks.get(p.token).response_code=-1;
      assert.equal(await reconcilePayment(pool,tx,config,a),'failed');
      const next=await request(`/api/orders/${o.orderId}/pay`,{method:'POST',token:o.accessToken});assert.equal(next.status,200);assert.notEqual(next.data.token,p.token);
      const payment=(await pool.query('SELECT * FROM webpay_payments WHERE token_ws=$1',[next.data.token])).rows[0];
      await request('/api/payments/webpay/return',{body:{TBK_TOKEN:payment.token_ws,TBK_ID_SESION:payment.session_id,TBK_ORDEN_COMPRA:payment.buy_order}});
      const current=(await request(`/api/orders/${o.orderId}`,{token:o.accessToken})).data;assert.equal(current.paymentStatus,'pending');assert.equal(current.canPay,true);
      // INITIALIZED remains reserved; the same current token is reusable while fresh.
    });
    await t.test('administración valida tarifas reales y datos del negocio',async()=>{
      const body={region:'Metropolitana de Santiago',comuna:'Comuna QA',carrier:'Paket',price:3500,daysMin:1,daysMax:3,santiagoCoverage:true,active:true,confirmedRealRate:true};
      assert.equal((await request('/api/admin/shipping',{cookie:adminCookie,body:{...body,confirmedRealRate:false}})).status,400);
      assert.equal((await request('/api/admin/shipping',{cookie:adminCookie,body:{...body,price:''}})).status,400);
      assert.equal((await request('/api/admin/shipping',{cookie:adminCookie,body:{...body,region:'Maule'}})).status,400);
      assert.equal((await request('/api/admin/shipping',{cookie:adminCookie,body})).status,200);
      assert.equal((await request('/api/admin/settings',{method:'PUT',cookie:adminCookie,body:{...business,rut:'invalid'}})).status,400);
      assert.equal((await request('/api/admin/orders?search=Cliente&offset=0',{cookie:adminCookie})).status,200);
    });
    await t.test('correo transaccional se confirma una vez sin usar servicios reales',async()=>{
      // A queued message from the previous version keeps its original body and key.
      await pool.query("UPDATE order_email_outbox SET template_version=1 WHERE order_id=$1 AND kind='payment_confirmed'",[paidOrder.orderId]);
      process.env.EMAIL_TEST_TO='test@example.test';let sends=0,failedMessage,failedOptions;
      const versions=new Set();
      const provider={emails:{send:async(message,opts)=>{
        sends++;assert.deepEqual(message.to,['test@example.test']);assert.ok(opts.idempotencyKey);
        const legacy=opts.idempotencyKey.endsWith('-v1');versions.add(legacy?1:2);
        if(legacy)assert.ok(message.text.includes('Condiciones aceptadas'));
        else {
          assert.ok(!message.text.includes(business.legalAddress));
          if(message.subject.includes('Tu compra'))assert.ok(Buffer.from(message.attachments[0].content,'base64').toString('utf8').includes('Condiciones aceptadas'));
          else assert.equal(message.attachments,undefined);
        }
        if(sends===1){failedMessage=structuredClone(message);failedOptions=structuredClone(opts);return {error:{message:'Respuesta incierta simulada'}};}
        if(opts.idempotencyKey===failedOptions.idempotencyKey){assert.deepEqual(message,failedMessage);assert.deepEqual(opts,failedOptions);}
        return {data:{id:randomUUID()}};
      }}};
      await sendEmailsOnce(pool,{...config,emailMode:'test'},provider);const first=sends;assert.ok(first>=2);
      assert.deepEqual(versions,new Set([1,2]));
      await pool.query("UPDATE order_email_outbox SET next_attempt_at=now() WHERE status='queued'");
      await sendEmailsOnce(pool,{...config,emailMode:'test'},provider);assert.equal(sends,first+1);
      await sendEmailsOnce(pool,{...config,emailMode:'test'},provider);assert.equal(sends,first+1);
      await pool.query("UPDATE order_email_outbox SET status='queued',attempts=1,started_at=now()-interval '25 hours',next_attempt_at=now() WHERE order_id=$1",[paidOrder.orderId]);
      await sendEmailsOnce(pool,{...config,emailMode:'test'},provider);assert.equal(sends,first+1);
      assert.equal((await pool.query('SELECT status FROM order_email_outbox WHERE order_id=$1 LIMIT 1',[paidOrder.orderId])).rows[0].status,'needs_review');
    });
    await t.test('sesión, seguimiento y transiciones de despacho requieren pago',async()=>{
      const id=paidOrder.orderId;
      assert.equal((await request(`/api/admin/orders/${id}/tracking`,{method:'PATCH',cookie:adminCookie,body:{trackingUrl:'javascript:alert(1)',trackingNumber:'A'}})).status,400);
      assert.equal((await request(`/api/admin/orders/${id}/tracking`,{method:'PATCH',cookie:adminCookie,body:{trackingUrl:'https://www.blue.cl/seguimiento',trackingNumber:'QA123'}})).status,200);
      for(const status of ['preparing','shipped','delivered'])assert.equal((await request(`/api/admin/orders/${id}/status`,{method:'PATCH',cookie:adminCookie,body:{status}})).status,200);
      const order=(await request(`/api/orders/${id}`,{token:paidOrder.accessToken})).data;assert.equal(order.status,'delivered');assert.equal(order.trackingNumber,'QA123');
      assert.equal((await request('/api/admin/logout',{method:'POST',cookie:adminCookie})).status,200);assert.equal((await request('/api/admin/me',{cookie:adminCookie})).status,401);
    });
    await t.test('producción protege las cookies y deshabilita rutas de laboratorio',async()=>{
      const prod=createApp({pool,config:{...config,production:true,origin:'https://malfi.example.test'},webpayClient:tx}).listen(0,'127.0.0.1');
      await new Promise(r=>prod.once('listening',r));
      try{
        const r=await fetch(`http://127.0.0.1:${prod.address().port}/api/admin/login`,{method:'POST',headers:{Origin:'https://malfi.example.test','Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify({email:'admin@example.test',password:'Test-password-123456'})});
        assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/__Host-malfi.sid=/);assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
        assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
        const legacy=await fetch(`http://127.0.0.1:${prod.address().port}/api/admin/webpay/test/status/1`);assert.equal(legacy.status,404);
      }finally{await new Promise(r=>prod.close(r));}
    });
    await t.test('rutas directas sirven la aplicación y API desconocida devuelve JSON',async()=>{
      for(const path of ['/checkout','/producto/1','/admin/login','/pedido/1','/terminos'])assert.equal((await request(path,{raw:true})).status,200);
      assert.equal((await request('/api/no-existe')).status,404);assert.equal((await request('/no-existe.js',{raw:true})).status,404);
    });
  }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});
