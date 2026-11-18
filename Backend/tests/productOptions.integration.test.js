import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('opciones y galería: publicación, validación, reservas y compra con PostgreSQL y proveedores simulados',{skip:!databaseUrl},async t=>{
  assert.match(new URL(databaseUrl).pathname,/(?:test|qa)/i);
  const pool=new pg.Pool({connectionString:databaseUrl});
  let server, uploads=0, failAt=0;
  const removed=[],banks=new Map();
  const imageClient={uploader:{
    upload_stream(options,callback){
      return new Writable({write(chunk,encoding,done){done();},final(done){
        const number=++uploads;
        if(number===failAt)callback(new Error('simulated upload failure'));
        else callback(null,{secure_url:'https://res.cloudinary.com/qa/image/upload/photo'+number+'.png',public_id:'qa/photo'+number});
        done();
      }});
    },
    async destroy(id){removed.push(id);return {result:'ok'};}
  }};
  const bank={
    async create(buy_order,session_id,amount){const token=randomBytes(32).toString('hex');banks.set(token,{buy_order,session_id,amount,status:'INITIALIZED'});return {token,url:'https://webpay3gint.transbank.cl/webpayserver/initTransaction'};},
    async commit(token){Object.assign(banks.get(token),{status:'AUTHORIZED',response_code:0,authorization_code:'123456',transaction_date:new Date().toISOString()});return banks.get(token);},
    async status(token){return banks.get(token);}
  };
  process.env.SESSION_SECRET='product-options-qa-session-000000000000000';
  const config={production:false,origin:'http://localhost:5173',apiOrigin:'http://localhost:3000',mode:'integration',enabled:true,emailMode:'disabled',secret:process.env.SESSION_SECRET,mpMode:'disabled',flowMode:'disabled'};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  try{
    await migrate(pool);await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,flow_checkouts,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,TRUE,1,3,TRUE,now())");
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)",[{legalName:'Tienda QA',rut:'11.111.111-1',legalAddress:'Dirección QA',email:'store@example.test',phone:'+56900000000',preparationDays:2,policiesVersion:'options-qa-v1',returnsInstructions:'Contactar a QA'}]);
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)',['admin@example.test',await bcrypt.hash('Qa-options-password-123456',4)]);
    server=createApp({pool,config,webpayClient:bank,mercadoPagoClient:null,flowClient:null,imageClient}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    let cookie;
    async function request(path,{method,body,form,token,key,auth=false}={}){
      const response=await fetch(base+path,{method:method||(body||form?'POST':'GET'),redirect:'manual',
        headers:{Origin:config.origin,...(body?{'Content-Type':'application/json'}:{}),...(auth&&cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},
        body:form||(body?JSON.stringify(body):undefined)});
      return {status:response.status,data:await response.json().catch(()=>null),headers:response.headers};
    }
    const fields={name:'Vela QA',description:'Producto de pruebas',price:'25000',category:'Velas de soja',stock:'5',colors:'["Blanco","Beige"]',aromas:'["Vainilla","Lavanda"]'};
    function form(values={},count=0){
      const data=new FormData();for(const [key,value] of Object.entries({...fields,...values}))data.append(key,value);
      for(let i=0;i<count;i++)data.append('images',new Blob([png],{type:'image/png'}),'foto'+i+'.png');
      return data;
    }
    let product;
    await t.test('protege la publicación y registra varias fotos y opciones sin exponer IDs internos',async()=>{
      assert.equal((await request('/api/admin/products',{form:form({},1)})).status,401);
      const login=await request('/api/admin/login',{body:{email:'admin@example.test',password:'Qa-options-password-123456'}});
      assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
      const created=await request('/api/admin/products',{form:form({},3),auth:true});
      assert.equal(created.status,201,JSON.stringify(created.data));product=created.data.product;
      assert.deepEqual(product.colors,['Blanco','Beige']);assert.deepEqual(product.aromas,['Vainilla','Lavanda']);
      assert.equal(product.images.length,3);assert.equal(product.image_url,product.images[0]);
      const visible=await request('/api/products/'+product.id);
      assert.equal(visible.status,200);assert.equal(visible.data.image_gallery,undefined);assert.equal(visible.data.image_public_id,undefined);
    });
    await t.test('rechaza fotos falsas, referencias ajenas y más de seis fotos sin subir ni borrar archivos',async()=>{
      const before=uploads;
      const invalid=form();invalid.append('images',new Blob(['not an image'],{type:'image/png'}),'falsa.png');
      assert.equal((await request('/api/admin/products',{form:invalid,auth:true})).status,400);
      assert.equal((await request('/api/admin/products/'+product.id,{method:'PUT',form:form({keepImages:'["https://evil.test/foto"]'},1),auth:true})).status,409);
      assert.equal((await request('/api/admin/products',{form:form({},7),auth:true})).status,400);
      assert.equal(uploads,before);assert.equal(removed.length,0);
    });
    await t.test('permite elegir principal, conservar fotos y eliminar solo las retiradas',async()=>{
      const old=product.images;
      const updated=await request('/api/admin/products/'+product.id,{method:'PUT',auth:true,
        form:form({keepImages:JSON.stringify([old[2]]),photoOrder:JSON.stringify(['new:0',old[2]])},1)});
      assert.equal(updated.status,200,JSON.stringify(updated.data));product=updated.data.product;
      assert.equal(product.images.length,2);assert.equal(product.images[1],old[2]);assert.equal(product.image_url,product.images[0]);
      assert.deepEqual(removed,['qa/photo1','qa/photo2']);
      failAt=uploads+2;const before=uploads;
      const failed=await request('/api/admin/products',{form:form({},2),auth:true});
      assert.equal(failed.status,500);
      assert.ok(removed.includes('qa/photo'+(before+1)));
      failAt=0;
    });
    const customer={fullName:'Cliente QA',email:'customer@example.test',phone:'+56900000000',region:'Metropolitana de Santiago',comuna:'Las Condes',address:'Dirección QA 123'};
    const lines=[{id:product.id,quantity:1,color:'Blanco',aroma:'Vainilla'},{id:product.id,quantity:1,color:'Beige',aroma:'Lavanda'}];
    const payload=items=>({customer,items,expectedTotal:50000,acceptTerms:true,termsVersion:'options-qa-v1'});
    await t.test('cotiza combinaciones por separado, conserva precio del servidor y suma el stock compartido',async()=>{
      const quote=await request('/api/checkout/quote',{body:{items:lines.map(item=>({...item,price:1}))}});
      assert.equal(quote.status,200);assert.equal(quote.data.subtotal,50000);assert.equal(quote.data.freeShippingEligible,true);
      assert.equal(quote.data.items[0].price,25000);assert.equal(quote.data.items.length,2);
      assert.equal((await request('/api/checkout/quote',{body:{items:[{...lines[0],color:'Azul'}]}})).status,409);
      assert.equal((await request('/api/checkout/quote',{body:{items:[{id:product.id,quantity:1}]}})).status,409);
      assert.equal((await request('/api/checkout/quote',{body:{items:[{...lines[0],quantity:4},{...lines[1],quantity:2}]}})).status,409);
      assert.equal((await request('/api/orders',{body:payload([{...lines[0],quantity:4},{...lines[1],quantity:2}]),key:randomUUID()})).status,409);
      assert.equal((await pool.query('SELECT reserved_stock FROM products WHERE id=$1',[product.id])).rows[0].reserved_stock,0);
    });
    await t.test('guarda opciones inmutables, descuenta stock una vez y expone el detalle a comprador y administración',async()=>{
      const key=randomUUID();
      const created=await request('/api/orders',{body:payload(lines),key});
      assert.equal(created.status,201,JSON.stringify(created.data));const order=created.data;
      assert.equal((await request('/api/orders',{body:payload(lines),key})).data.orderId,order.orderId);
      assert.equal((await pool.query('SELECT reserved_stock FROM products WHERE id=$1',[product.id])).rows[0].reserved_stock,2);
      assert.equal((await request('/api/orders',{body:payload([{...lines[0],aroma:'Lavanda'},lines[1]]),key})).status,409);
      // Later catalog edits do not rewrite an already accepted order.
      await pool.query("UPDATE products SET colors=ARRAY['Terracota'],aromas=ARRAY['Cítrico'] WHERE id=$1",[product.id]);
      const start=await request('/api/orders/'+order.orderId+'/pay',{method:'POST',token:order.accessToken});
      assert.equal(start.status,200,JSON.stringify(start.data));
      const callback=()=>request('/api/payments/webpay/return',{body:{token_ws:start.data.token}});
      assert.equal((await callback()).status,303);assert.equal((await callback()).status,303);
      const read=await request('/api/orders/'+order.orderId,{token:order.accessToken});
      assert.equal(read.data.paymentStatus,'paid');assert.equal(read.data.items.length,2);
      assert.deepEqual(read.data.items.map(item=>item.selected_color),['Beige','Blanco']);
      assert.deepEqual((await pool.query('SELECT stock,reserved_stock FROM products WHERE id=$1',[product.id])).rows[0],{stock:3,reserved_stock:0});
      const admin=await request('/api/admin/orders/'+order.orderId,{auth:true});
      assert.equal(admin.status,200);assert.deepEqual(admin.data.items.map(item=>item.selected_aroma),['Lavanda','Vainilla']);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE order_id=$1',[order.orderId])).rows[0].n,2);
    });
    await t.test('publica talleres con fechas válidas y exige elegir una vigente antes de reservar', async () => {
      const dates = [7,14].map(days => new Date(Date.now() + days * 86400000).toISOString().slice(0,10));
      const values = {name:'Taller QA',category:'Talleres',colors:'[]',aromas:'[]',workshopDates:JSON.stringify(dates)};
      const noDates = await request('/api/admin/products',{form:form({...values,workshopDates:'[]'},1),auth:true});
      assert.equal(noDates.status,400);
      const invalid = await request('/api/admin/products',{form:form({...values,workshopDates:'["2026-02-29"]'},1),auth:true});
      assert.equal(invalid.status,400);
      const created = await request('/api/admin/products',{form:form(values,1),auth:true});
      assert.equal(created.status,201,JSON.stringify(created.data));
      const workshop = created.data.product;
      assert.deepEqual(workshop.workshop_dates,dates);
      const quote = items => request('/api/checkout/quote',{body:{items}});
      for (const workshopDate of ['', '2001-01-01','2099-01-01']) {
        const badLine = [{id:workshop.id,quantity:1,workshopDate}];
        assert.equal((await quote(badLine)).status,409);
        assert.equal((await request('/api/orders',{body:payload(badLine),key:randomUUID()})).status,409);
      }
      const selections = dates.map(workshopDate => ({id:workshop.id,quantity:1,workshopDate}));
      const reviewed = await quote(selections);
      assert.equal(reviewed.status,200);assert.equal(reviewed.data.subtotal,50000);
      assert.deepEqual(reviewed.data.items.map(item=>item.workshopDate),dates);
      const key = randomUUID();
      const order = await request('/api/orders',{body:payload(selections),key});
      assert.equal(order.status,201,JSON.stringify(order.data));
      assert.equal((await request('/api/orders',{body:payload(selections),key})).data.orderId,order.data.orderId);
      // Changing only the selected date cannot reuse the same checkout.
      assert.equal((await request('/api/orders',{body:payload([{...selections[0],quantity:2}]),key})).status,409);
      await pool.query("UPDATE products SET workshop_dates=ARRAY['2099-12-31'] WHERE id=$1",[workshop.id]);
      assert.equal((await quote(selections)).status,409);
      const read = await request('/api/orders/'+order.data.orderId,{token:order.data.accessToken});
      assert.deepEqual(read.data.items.map(item=>item.selected_workshop_date),dates);
      const admin = await request('/api/admin/orders/'+order.data.orderId,{auth:true});
      assert.deepEqual(admin.data.items.map(item=>item.selected_workshop_date),dates);
      assert.deepEqual((await pool.query('SELECT stock,reserved_stock FROM products WHERE id=$1',[workshop.id])).rows[0],{stock:5,reserved_stock:2});
      // A later edit must not change the dates accepted in the existing order.
      const start = await request('/api/orders/'+order.data.orderId+'/pay',{method:'POST',token:order.data.accessToken});
      assert.equal(start.status,200,JSON.stringify(start.data));
      assert.equal((await request('/api/payments/webpay/return',{body:{token_ws:start.data.token}})).status,303);
      assert.equal((await request('/api/payments/webpay/return',{body:{token_ws:start.data.token}})).status,303);
      assert.deepEqual((await pool.query('SELECT stock,reserved_stock FROM products WHERE id=$1',[workshop.id])).rows[0],{stock:3,reserved_stock:0});
      assert.deepEqual((await request('/api/orders/'+order.data.orderId,{token:order.data.accessToken})).data.items.map(item=>item.selected_workshop_date),dates);
    });
    await t.test('publica y edita horarios, reserva AM y PM en la misma fecha y conserva ambos en el pedido', async () => {
      const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const values = { name:'Taller con turnos', category:'Talleres', colors:'[]', aromas:'[]',
        workshopDates:JSON.stringify([date]), workshopTimes:JSON.stringify(['AM', 'PM', 'pm']) };
      const created = await request('/api/admin/products', { auth:true, form:form(values, 1) });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const workshop = created.data.product;
      const path = '/api/admin/products/' + workshop.id;
      assert.deepEqual((await request('/api/products/' + workshop.id)).data.workshop_times, ['AM', 'PM']);
      const edit = { ...values, keepImages:JSON.stringify(workshop.images), photoOrder:JSON.stringify(workshop.images) };
      delete edit.workshopTimes;
      const legacy = await request(path, { method:'PUT', auth:true, form:form(edit) });
      assert.deepEqual(legacy.data.product.workshop_times, ['AM', 'PM']);
      const quote = items => request('/api/checkout/quote', { body:{items} });
      const line = { id:workshop.id, quantity:1, workshopDate:date };
      for (const time of ['', 'Noche']) assert.equal((await quote([{ ...line, workshopTime:time }])).status, 409);
      const selections = ['am', 'PM'].map(workshopTime => ({...line, workshopTime}));
      const reviewed = await quote(selections);
      assert.equal(reviewed.data.subtotal, 50000);
      assert.deepEqual(reviewed.data.items.map(i => i.workshopTime), ['AM', 'PM']);
      assert.equal((await quote(selections.map(i => ({...i, quantity:3})))).status, 409);
      const key = randomUUID(), order = await request('/api/orders', { body:payload(selections), key });
      assert.equal(order.status, 201, JSON.stringify(order.data));
      const mismatch = await request('/api/orders', { body:payload([selections[0], {...selections[1], workshopTime:'Noche'}]), key });
      assert.equal(mismatch.status, 409);
      assert.match(mismatch.data.error, /otros datos/);
      const updated = await request(path, { method:'PUT', auth:true, form:form({...edit, workshopTimes:'["Tarde"]'}) });
      assert.deepEqual(updated.data.product.workshop_times, ['Tarde']);
      assert.equal((await quote(selections)).status, 409);
      assert.equal((await request('/api/orders', { body:payload(selections), key })).data.orderId, order.data.orderId);
      const read = await request('/api/orders/' + order.data.orderId, { token:order.data.accessToken });
      const managed = await request('/api/admin/orders/' + order.data.orderId, { auth:true });
      for (const result of [read, managed]) {
        assert.deepEqual(result.data.items.map(i => i.selected_workshop_time), ['AM', 'PM']);
        assert.deepEqual(result.data.items.map(i => i.selected_workshop_date), [date, date]);
      }
      const cleared = await request(path, { method:'PUT', auth:true, form:form({...edit, workshopTimes:'[]'}) });
      assert.deepEqual(cleared.data.product.workshop_times, []);
      assert.equal((await quote([line])).status, 200);
    });
    await t.test('los insumos se cotizan por unidades con precio del servidor y límite de stock', async () => {
      const created = await request('/api/admin/products',{form:form({name:'Mechas QA',category:'Insumos',price:'500',stock:'12',colors:'[]',aromas:'[]'},1),auth:true});
      assert.equal(created.status,201,JSON.stringify(created.data));
      const supply = created.data.product;
      const quote = await request('/api/checkout/quote',{body:{items:[{id:supply.id,quantity:7,price:1}]}});
      assert.equal(quote.status,200);assert.equal(quote.data.subtotal,3500);
      assert.equal(quote.data.items[0].quantity,7);assert.equal(quote.data.items[0].price,500);
      assert.equal((await request('/api/checkout/quote',{body:{items:[{id:supply.id,quantity:13}]}})).status,409);
      assert.equal((await request('/api/checkout/quote',{body:{items:[{id:supply.id,quantity:1,workshopDate:'2099-01-01'}]}})).status,409);
      assert.equal((await request('/api/checkout/quote',{body:{items:[{id:supply.id,quantity:1.5}]}})).status,400);
    });
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
});
