import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { releaseExpiredOrders } from '../services/payments.js';
import { startFlow, reconcileFlowCheckout } from '../services/flow.js';
import { commerceCycle, sendEmailsOnce } from '../services/commerceWorker.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('Flow: checkout, confirmación canónica, reservas y correos con PostgreSQL real y API simulada',{skip:!databaseUrl},async t=>{
  assert.match(new URL(databaseUrl).pathname,/(?:test|qa)/i);
  const pool=new pg.Pool({connectionString:databaseUrl});let server,created=0,lost=false,flowNumber=900000,mpCreated=0;
  process.env.SESSION_SECRET='flow-qa-session-000000000000000000000000';
  const config={production:false,origin:'http://localhost:5173',apiOrigin:'http://localhost:3000',mode:'disabled',enabled:true,emailMode:'disabled',secret:process.env.SESSION_SECRET,
    mpMode:'integration',mpAccessToken:'qa-private-mp',mpWebhookSecret:'qa-mp-secret',mpCollectorId:'123456',mpPublicOrigin:'https://qa.example.test',
    flowMode:'integration',flowApiKey:'qa-private-flow-key',flowSecretKey:'qa-private-flow-secret',flowPublicOrigin:'https://qa.example.test'};
  const flowOrders=new Map();
  const flow={
    createPayment:async body=>{
      created++;const token=`qa_flow_token_${randomUUID()}`,flowOrder=++flowNumber;
      const record={body:structuredClone(body),token,flowOrder,commerceOrder:body.commerceOrder,currency:'CLP',amount:body.amount,status:1,paymentData:{media:'webpay'}};
      flowOrders.set(token,record);await new Promise(r=>setTimeout(r,20));
      if(lost){lost=false;throw Error('Create reply lost');}
      return {url:'https://sandbox.flow.cl/app/web/pay.php',token,flowOrder};
    },
    getStatus:async token=>{const p=flowOrders.get(token);if(!p)throw Error('Unknown token');return structuredClone(p);},
    getStatusByCommerceId:async id=>{const p=[...flowOrders.values()].find(p=>p.commerceOrder===id);if(!p)throw Error('Not found');return structuredClone(p);}
  };
  const mp={getSeller:async()=>({id:123456,site_id:'MLC',tags:['test_user']}),createPreference:async body=>{mpCreated++;return {...body,id:'pref_flow_coexist_qa',collector_id:123456,init_point:'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref_flow_coexist_qa'};}};
  try{
    await migrate(pool);await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,flow_checkouts,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO products(name,description,price,category,stock) VALUES('Set QA','Soja',50000,'Velas de soja',100),('Vela QA','Soja',20000,'Velas de soja',100)");
    await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,TRUE,1,3,TRUE,now())");
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)",[{legalName:'Tienda QA',rut:'76.123.456-0',legalAddress:'Dirección QA',email:'store@example.test',phone:'+56912345678',preparationDays:2,policiesVersion:'flow-qa-v1',returnsInstructions:'Contactar a QA'}]);
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)',['admin@example.test',await bcrypt.hash('Qa-flow-password-123456',4)]);
    server=createApp({pool,config,webpayClient:null,mercadoPagoClient:mp,flowClient:flow}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function request(path,{body,method=body?'POST':'GET',token,key,cookie,origin=config.origin,form=false}={}){
      const r=await fetch(base+path,{method,redirect:'manual',headers:{...(origin?{Origin:origin}:{}),...(body?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...(key?{'Idempotency-Key':key}:{}),...(cookie?{Cookie:cookie}:{})},body:body?(form?new URLSearchParams(body).toString():JSON.stringify(body)):undefined});
      return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
    }
    const payload=(overrides={})=>({customer:{fullName:'Cliente QA',email:'customer@example.test',phone:'+56912345678',region:'Metropolitana de Santiago',comuna:'Las Condes',address:'Dirección QA 123'},items:[{id:1,quantity:1}],expectedTotal:50000,acceptTerms:true,termsVersion:'flow-qa-v1',paymentProvider:'flow',...overrides});
    async function order(body=payload()){const key=randomUUID(),r=await request('/api/orders',{body,key});assert.equal(r.status,201,JSON.stringify(r.data));return {...r.data,key,body};}
    const read=async o=>(await request(`/api/orders/${o.orderId}`,{token:o.accessToken})).data;
    const pay=o=>request(`/api/orders/${o.orderId}/pay`,{method:'POST',token:o.accessToken});
    const checkout=async o=>(await pool.query('SELECT * FROM flow_checkouts WHERE order_id=$1',[o.orderId])).rows[0];
    const record=async o=>{const a=await checkout(o);return [...flowOrders.values()].find(p=>p.commerceOrder===a.commerce_order);};
    const callback=(p,extra={},returning=false)=>{
      const u=new URL(returning?p.body.urlReturn:p.body.urlConfirmation);
      return request(u.pathname+u.search,{origin:null,form:true,body:{token:p.token,...extra}});
    };
    const stock=async id=>(await pool.query('SELECT stock,reserved_stock FROM products WHERE id=$1',[id])).rows[0];
    let first,cookie;
    await t.test('ofrece Mercado Pago y Flow sin exponer claves y conserva la protección de origen',async()=>{
      const s=await request('/api/store');assert.deepEqual(s.data.paymentProviders.map(p=>p.id),['mercadopago','flow']);
      assert.ok(!JSON.stringify(s.data).includes(config.flowApiKey));assert.ok(!JSON.stringify(s.data).includes(config.flowSecretKey));
      assert.equal((await request('/api/orders',{body:payload(),key:randomUUID(),origin:null})).status,403);
      const login=await request('/api/admin/login',{body:{email:'admin@example.test',password:'Qa-flow-password-123456'}});cookie=login.headers.get('set-cookie').split(';')[0];
    });
    await t.test('doble clic conserva un pedido, un intento y el importe con despacho gratis desde $50.000',async()=>{
      const key=randomUUID(),body=payload();const [a,b]=await Promise.all([request('/api/orders',{body,key}),request('/api/orders',{body,key})]);
      assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.orderId,b.data.orderId);first={...a.data,key,body};
      assert.equal((await request('/api/orders',{body:{...body,paymentProvider:'mercadopago'},key})).status,409);
      const [x,y]=await Promise.all([pay(first),pay(first)]);assert.ok([x,y].some(r=>r.status===200));assert.equal(created,1);
      assert.equal((await pay(first)).status,200);assert.equal(created,1);
      const p=await record(first);assert.equal(p.amount,50000);assert.equal(p.body.currency,'CLP');assert.ok(p.body.timeout>0&&p.body.timeout<=3600);
      assert.equal((await read(first)).shipping,0);assert.equal((await read(first)).total,50000);
      assert.deepEqual(await stock(1),{stock:100,reserved_stock:1});
    });
    await t.test('un retorno o status enviado por el navegador no confirma un pago pendiente',async()=>{
      const p=await record(first);
      assert.equal((await request('/api/payments/flow/confirmation',{body:{token:p.token,status:2},origin:null,form:true})).status,400);
      const fake=await request('/api/payments/flow/return?state='+ '0'.repeat(64),{body:{token:p.token},origin:null,form:true});assert.equal(fake.status,303);assert.ok(!fake.headers.get('location').includes('#token='));
      assert.equal((await callback(p,{status:2})).status,200);
      assert.equal((await read(first)).paymentStatus,'pending');assert.equal((await read(first)).canPay,false);
      assert.ok(!JSON.stringify(await read(first)).includes(p.token));
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox')).rows[0].n,0);
      assert.equal((await request(`/api/admin/orders/${first.orderId}/payments`)).status,401);
    });
    await t.test('rechaza moneda, importe, referencias y cuenta distintos de los guardados',async()=>{
      const p=await record(first);
      for(const [field,value] of Object.entries({currency:'USD',amount:1,commerceOrder:'other-order',flowOrder:999})){
        const old=p[field];p[field]=value;assert.equal((await callback(p)).status,500,field);p[field]=old;
        assert.equal((await read(first)).paymentStatus,'pending');
      }
      const a=await checkout(first);
      await assert.rejects(()=>reconcileFlowCheckout(pool,flow,{...config,flowApiKey:'other-account'},a));
      await assert.rejects(()=>reconcileFlowCheckout(pool,flow,{...config,flowMode:'production'},a));
      const u=new URL(p.body.urlReturn);assert.equal((await request(u.pathname+u.search,{body:{token:'wrong_token_12345'},form:true,origin:null})).headers.get('location'),config.origin+'/pedido');
    });
    await t.test('confirmaciones concurrentes descuentan stock y encolan dos correos una sola vez',async()=>{
      const p=await record(first);p.status=2;
      const [a,b,c]=await Promise.all([callback(p),callback(p),callback(p,{},true)]);
      assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,303);
      assert.equal(c.headers.get('location'),`${config.origin}/pedido/${first.orderId}#token=${first.accessToken}`);
      assert.equal((await read(first)).paymentStatus,'paid');assert.deepEqual(await stock(1),{stock:99,reserved_stock:0});
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE order_id=$1',[first.orderId])).rows[0].n,2);
      p.status=1;assert.equal((await callback(p)).status,200);assert.equal((await read(first)).paymentStatus,'paid');p.status=2;
      const admin=await request(`/api/admin/orders/${first.orderId}/payments`,{cookie});assert.equal(admin.data[0].provider,'flow');assert.ok(!JSON.stringify(admin.data).includes(p.token));
    });
    await t.test('una respuesta de creación perdida se recupera por callback o conciliación sin crear otro cobro',async()=>{
      for(const recovery of ['callback','worker']){
        const o=await order(payload({items:[{id:2,quantity:1}],expectedTotal:23000}));lost=true;const before=created;
        assert.equal((await pay(o)).status,502);assert.equal((await pay(o)).status,409);assert.equal(created,before+1);
        const a=await checkout(o);assert.equal(a.token,null);const p=await record(o);p.status=2;
        if(recovery==='callback')assert.equal((await callback(p)).status,200);
        else await commerceCycle(pool,config,null,{flowClient:flow});
        assert.equal((await read(o)).paymentStatus,'paid');assert.equal((await read(o)).total,23000);assert.equal(created,before+1);
      }
    });
    await t.test('rechazo o anulación libera una vez la reserva; un pago tardío queda en revisión sin vender stock ajeno',async()=>{
      for(const status of [3,4]){
        const o=await order();await pay(o);const p=await record(o);p.status=status;const before=await stock(1);
        assert.equal((await callback(p)).status,200);assert.equal((await callback(p)).status,200);
        assert.deepEqual(await stock(1),{stock:before.stock,reserved_stock:before.reserved_stock-1});
        assert.equal((await read(o)).status,'cancelled');assert.equal((await read(o)).canPay,false);
        p.status=1;await callback(p);assert.equal((await read(o)).status,'cancelled');
        if(status===3){p.status=2;await callback(p);const saved=await read(o);assert.equal(saved.paymentStatus,'paid');assert.equal(saved.status,'payment_review');assert.equal(saved.requiresPaymentReview,true);assert.equal((await stock(1)).stock,before.stock);}
      }
    });
    await t.test('un timeout o un pago incierto no libera inventario ni permite cancelar desde administración',async()=>{
      const o=await order();await pay(o);await pool.query("UPDATE orders SET expires_at=now()-interval '2 minutes' WHERE id=$1",[o.orderId]);
      await releaseExpiredOrders(pool);assert.equal((await pool.query('SELECT inventory_reserved FROM orders WHERE id=$1',[o.orderId])).rows[0].inventory_reserved,true);
      assert.equal((await request(`/api/admin/orders/${o.orderId}/status`,{method:'PATCH',body:{status:'cancelled'},cookie})).status,409);
      const r=await request(`/api/admin/orders/${o.orderId}/reconcile`,{method:'POST',cookie});assert.equal(r.status,200);assert.equal(r.data.outcome,'pending');
    });
    await t.test('respeta despacho pagado y retiro sin costo; Mercado Pago sigue siendo independiente',async()=>{
      const shipped=await order(payload({items:[{id:2,quantity:1}],expectedTotal:23000}));await pay(shipped);assert.equal((await record(shipped)).amount,23000);
      const pickup=await order(payload({items:[{id:2,quantity:1}],expectedTotal:20000,deliveryMethod:'pickup',customer:{fullName:'Cliente QA',email:'customer@example.test',phone:'+56912345678'}}));await pay(pickup);assert.equal((await record(pickup)).amount,20000);assert.equal((await read(pickup)).shipping,0);
      const mpOrder=await order(payload({items:[{id:2,quantity:1}],expectedTotal:23000,paymentProvider:'mercadopago'}));const before=created;
      assert.equal((await pay(mpOrder)).status,200);assert.equal(mpCreated,1);assert.equal(created,before);
      await assert.rejects(()=>startFlow(pool,flow,config,mpOrder.orderId));
    });
    await t.test('los correos Flow se generan solo para pagos confirmados con stock resuelto',async()=>{
      process.env.EMAIL_TEST_TO='qa@example.test';const sent=[];
      await sendEmailsOnce(pool,{...config,emailMode:'test'},{emails:{send:async(msg,options)=>{sent.push(msg);assert.ok(options.idempotencyKey);return {data:{id:randomUUID()}};}}});
      assert.equal(sent.length,6);assert.ok(sent.some(e=>e.text.includes('Gratis')));
      const pending=(await pool.query("SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE status<>'sent'")).rows[0].n;assert.equal(pending,0);
    });
    await t.test('el pago original no deshace un reembolso registrado ni vuelve a descontar inventario',async()=>{
      const before=await stock(1);
      await pool.query("UPDATE orders SET payment_status='refunded',status='payment_review' WHERE id=$1",[first.orderId]);
      assert.equal((await callback(await record(first))).status,200);
      assert.equal((await read(first)).paymentStatus,'refunded');assert.deepEqual(await stock(1),before);
    });
  } finally {if(server)await new Promise(r=>server.close(r));await pool.end();}
});
