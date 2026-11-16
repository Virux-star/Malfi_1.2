import { providerMode, providerAvailable } from '../config/paymentProviders.js';
import { startMercadoPago, reconcileMpCheckout } from '../services/mercadoPago.js';
import { rateLimit } from 'express-rate-limit';
import { readiness } from '../services/store.js';
import { resolveShipping } from '../services/shipping.js';
import { pickupLocation } from '../config/fulfillment.js';
import { digest, orderToken, validId, fail, customerOrder, startPayment, settlePayment, validBank, bankApproved, reconcilePayment } from '../services/payments.js';
const uuid = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const tokenFrom = req => (req.get('Authorization') || '').replace(/^Bearer /,'');
const handler = fn => async(req,res,next)=>{try {await fn(req,res);}catch(e){if(e.status)res.status(e.status).json({error:e.message});else next(e);}};
const limited = limit => rateLimit({windowMs:15*60_000,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.'}});

export function registerCustomerPayments(app,pool,requireAdmin,config,tx,mpClient) {
  app.post('/api/orders',limited(15),handler(async(req,res)=>{
    const key=req.get('Idempotency-Key');
    if (!uuid(key)) throw fail('Recarga la página e intenta nuevamente.',400);
    const c=req.body?.customer || {};
    const deliveryMethod=req.body?.deliveryMethod ?? 'shipping';
    if (!['shipping','pickup'].includes(deliveryMethod)) throw fail('Elige una forma de entrega válida.',400);
    const pickup=deliveryMethod==='pickup';
    if (pickup&&!pickupLocation.enabled) throw fail('El retiro en tienda no está disponible.',409);
    const customer={};
    for (const [field,max] of Object.entries({fullName:120,email:254,phone:25,region:100,comuna:100,address:250,reference:300})) {
      const value=pickup&&['region','comuna','address','reference'].includes(field)
        ? (pickupLocation[field]||'') : typeof c[field]==='string'?c[field].trim():'';
      if ((field!=='reference'&&!value)||value.length>max) throw fail('Completa correctamente tus datos de contacto y entrega.',400);
      customer[field]=value;
    }
    customer.email=customer.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||!/^[+0-9\s()-]{8,25}$/.test(customer.phone)) throw fail('Revisa tu correo y teléfono.',400);
    if (!Array.isArray(req.body.items)||req.body.items.length<1||req.body.items.length>30) throw fail('Carrito no válido.',400);
    const items=req.body.items.map(i=>({id:Number(i?.id),quantity:Number(i?.quantity)})).sort((a,b)=>a.id-b.id);
    if (items.some(i=>!Number.isInteger(i.id)||i.id<1||i.id>2147483647||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>100)||new Set(items.map(i=>i.id)).size!==items.length) throw fail('Productos o cantidades no válidos.',400);
    if (req.body.acceptTerms!==true) throw fail('Debes aceptar los términos y la política de privacidad.',400);
    const provider=req.body.paymentProvider||'webpay';
    if (!['webpay','mercadopago'].includes(provider)) throw fail('Elige un medio de pago válido.',400);
    const fingerprint=digest(JSON.stringify({customer,items,termsVersion:req.body.termsVersion,...(provider==='mercadopago'?{provider}:{}),...(pickup?{deliveryMethod}:{})}));
    const token=orderToken(key,config);
    const client=await pool.connect();
    let order;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
      const existing=(await client.query('SELECT * FROM orders WHERE checkout_key=$1',[key])).rows[0];
      if (existing) {
        if (existing.checkout_fingerprint!==fingerprint) throw fail('El pedido guardado contiene otros datos. Vuelve al carrito para iniciar otra compra.');
        order=existing;
      } else {
        const state=await readiness(client,config);
        if (!providerAvailable(config,provider)) throw fail('El medio de pago elegido no está disponible.',503);
        if (!state.ready) throw fail('Estamos preparando la tienda para recibir compras. Contáctanos si necesitas ayuda.',503);
        if (req.body.termsVersion!==state.store.policiesVersion) throw fail('Las condiciones de compra cambiaron. Recarga la página para revisarlas.');
        const products=(await client.query('SELECT id,name,price,stock,reserved_stock FROM products WHERE id=ANY($1::int[]) AND active=TRUE ORDER BY id FOR UPDATE',[items.map(i=>i.id)])).rows;
        const byId=new Map(products.map(p=>[p.id,p]));
        let subtotal=0;
        for (const i of items) {
          const p=byId.get(i.id);
          if (!p||p.stock-p.reserved_stock<i.quantity) throw fail(`Uno de los productos no tiene stock suficiente. Revisa tu carrito.`);
          subtotal+=p.price*i.quantity;
        }
        const rate=pickup?{...pickupLocation,carrier:'Retiro en tienda',price_clp:0,delivery_days_min:0,delivery_days_max:0}
          :await resolveShipping(client,customer.region,customer.comuna,{lock:true});
        if (!rate) throw fail('No tenemos despacho configurado para este destino.');
        const total=subtotal+rate.price_clp;
        if (!Number.isSafeInteger(total)||total<1||total>999999999) throw fail('El monto del pedido supera el límite permitido.',400);
        // Explicit review of current server totals prevents an unnoticed price change.
        if (req.body.expectedTotal!==total) throw fail('El precio o despacho cambió. Recarga la página y revisa el total antes de pagar.');
        order=(await client.query(`INSERT INTO orders(customer_name,customer_email,customer_phone,shipping_region,shipping_comuna,shipping_address,shipping_reference,carrier,subtotal_clp,shipping_clp,total_clp,inventory_reserved,checkout_key,checkout_fingerprint,access_token_hash,payment_mode,expires_at,terms_version,accepted_at,business_snapshot,delivery_days_min,delivery_days_max,payment_provider,delivery_method)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14,$15,now()+interval '60 minutes',$16,now(),$17,$18,$19,$20,$21) RETURNING *`,[
            customer.fullName,customer.email,customer.phone,rate.region,rate.comuna,customer.address,customer.reference||null,rate.carrier,subtotal,rate.price_clp,total,key,fingerprint,digest(token),providerMode(config,provider),state.store.policiesVersion,state.store,rate.delivery_days_min+state.store.preparationDays,rate.delivery_days_max+state.store.preparationDays,provider,deliveryMethod
          ])).rows[0];
        for (const i of items) {
          const p=byId.get(i.id);
          await client.query('UPDATE products SET reserved_stock=reserved_stock+$1 WHERE id=$2',[i.quantity,i.id]);
          await client.query('INSERT INTO order_items(order_id,product_id,product_name,unit_price_clp,quantity,line_total_clp) VALUES($1,$2,$3,$4,$5,$6)',[order.id,p.id,p.name,p.price,i.quantity,p.price*i.quantity]);
        }
      }
      await client.query('COMMIT');
    } catch(e) {await client.query('ROLLBACK');throw e;}
    finally {client.release();}
    res.status(201).json({orderId:order.id,accessToken:token,total:Number(order.total_clp),carrier:order.carrier,paymentProvider:order.payment_provider,deliveryMethod:order.delivery_method});
  }));

  app.get('/api/orders/:id',limited(120),handler(async(req,res)=>{
    const o=await customerOrder(pool,req.params.id,tokenFrom(req));
    let p,canPay=false,requiresPaymentReview=false;
    const payable=config.enabled && providerAvailable(config,o.payment_provider) && providerMode(config,o.payment_provider)===o.payment_mode && o.status==='pending_payment' && o.payment_status==='pending' && o.inventory_reserved && new Date(o.expires_at)>new Date();
    if (o.payment_provider==='mercadopago') {
      const checkout=(await pool.query('SELECT * FROM mercadopago_checkouts WHERE order_id=$1',[o.id])).rows[0];
      let payment;
      if (checkout) payment=(await pool.query(`SELECT * FROM mercadopago_payments WHERE checkout_id=$1 ORDER BY (payment_id=$2) DESC,observed_at DESC LIMIT 1`,[checkout.id,checkout.settled_payment_id||''])).rows[0];
      requiresPaymentReview=checkout?.state==='review';
      p=checkout?{provider:'mercadopago',state:payment?.provider_status==='rejected'&&checkout.state==='created'?'failed':checkout.state,mode:checkout.mode,
        reference:payment?.payment_id||checkout.preference_id,preference_id:checkout.preference_id,payment_id:payment?.payment_id,
        provider_status:payment?.provider_status,payment_type_code:payment?.payment_type_id,payment_method_id:payment?.payment_method_id,
        card_last4:payment?.card_last4,bank_transaction_date:payment?.approved_at,amount_clp:checkout.amount_clp}:null;
      canPay=Boolean(payable&&(!checkout||(checkout.state==='created'&&checkout.checkout_url&&new Date(checkout.preference_expires_at)>new Date())));
    } else {
      p=(await pool.query('SELECT state,mode,buy_order,authorization_code,payment_type_code,card_last4,bank_transaction_date,amount_clp,created_at FROM webpay_payments WHERE order_id=$1 ORDER BY created_at DESC',[o.id])).rows[0];
      if(p)p={...p,provider:'webpay'};
      canPay=Boolean(payable&&(!p||p.state==='failed'||(p.state==='created'&&Date.now()-new Date(p.created_at)<4*60_000)));
    }
    const items=(await pool.query('SELECT product_id,product_name,unit_price_clp,quantity,line_total_clp FROM order_items WHERE order_id=$1 ORDER BY id',[o.id])).rows;
    res.json({id:o.id,status:o.status,paymentStatus:o.payment_status,mode:o.payment_mode,total:Number(o.total_clp),subtotal:Number(o.subtotal_clp),shipping:Number(o.shipping_clp),carrier:o.carrier,comuna:o.shipping_comuna,
      deliveryDaysMin:o.delivery_days_min,deliveryDaysMax:o.delivery_days_max,createdAt:o.created_at,paidAt:o.paid_at,expiresAt:o.expires_at,trackingUrl:o.tracking_url,trackingNumber:o.tracking_number,
      deliveryMethod:o.delivery_method,pickupAddress:o.delivery_method==='pickup'?`${o.shipping_address}, ${o.shipping_comuna}`:null,
      canPay,paymentProvider:o.payment_provider,requiresPaymentReview,payment:p||null,items});
  }));
  app.post('/api/orders/:id/pay',limited(20),handler(async(req,res)=>{
    const order=await customerOrder(pool,req.params.id,tokenFrom(req));
    if (!config.enabled) throw fail('Los pagos están temporalmente deshabilitados.',503);
    res.json(order.payment_provider==='mercadopago'?await startMercadoPago(pool,mpClient,config,req.params.id):await startPayment(pool,tx,config,req.params.id));
  }));

  const redirect=async(res,orderId)=>{
    if (!orderId) return res.redirect(303,`${config.origin}/pedido`);
    const o=(await pool.query('SELECT checkout_key FROM orders WHERE id=$1',[orderId])).rows[0];
    if (!o?.checkout_key) return res.redirect(303,`${config.origin}/pedido`);
    return res.redirect(303,`${config.origin}/pedido/${orderId}#token=${orderToken(o.checkout_key,config)}`);
  };
  const callback=async(req,res,next)=>{
    if (!tx) return res.sendStatus(503);
    const p=req.method==='POST'?req.body:req.query;
    const token=typeof p?.token_ws==='string'?p.token_ws:typeof p?.TBK_TOKEN==='string'?p.TBK_TOKEN:null;
    try {
      let payment;
      if (token && /^[a-zA-Z0-9_-]{20,150}$/.test(token)) payment=(await pool.query('SELECT * FROM webpay_payments WHERE token_ws=$1',[token])).rows[0];
      // Timeout callbacks have no token: identifiers must match both stored fields.
      else if (typeof p?.TBK_ID_SESION==='string'&&typeof p?.TBK_ORDEN_COMPRA==='string'&&p.TBK_ID_SESION.length<=61&&p.TBK_ORDEN_COMPRA.length<=26) payment=(await pool.query('SELECT * FROM webpay_payments WHERE session_id=$1 AND buy_order=$2',[p.TBK_ID_SESION,p.TBK_ORDEN_COMPRA])).rows[0];
      if (!payment||payment.mode!==config.mode) return redirect(res);
      if (p.token_ws && payment.state==='created') {
        const claimed=await pool.query("UPDATE webpay_payments SET state='processing',updated_at=now() WHERE id=$1 AND state='created' RETURNING id",[payment.id]);
        if (claimed.rowCount) {
          try {
            const bank=await tx.commit(token);
            if (bankApproved(bank,payment)) await settlePayment(pool,payment.id,bank);
            else if (validBank(bank,payment)&&bank.status==='FAILED') await pool.query("UPDATE webpay_payments SET state='failed',bank_status='FAILED',response_code=$2,updated_at=now() WHERE id=$1 AND state='processing'",[payment.id,Number.isInteger(bank.response_code)?bank.response_code:null]);
            else await pool.query("UPDATE webpay_payments SET state='review',updated_at=now() WHERE id=$1 AND state='processing'",[payment.id]);
          } catch(e) {
            await pool.query("UPDATE webpay_payments SET state='review',last_error='Confirmación pendiente de conciliación.',updated_at=now() WHERE id=$1 AND state='processing'",[payment.id]);
            console.error('Confirmación Webpay pendiente:',payment.id,e.message);
          }
        }
      } else if (payment.state!=='paid') {
        try {await reconcilePayment(pool,tx,config,payment);}catch(e){console.error('Retorno Webpay:',payment.id,e.message);}
      }
      return redirect(res,payment.order_id);
    } catch(e) {next(e);}
  };
  app.get('/api/payments/webpay/return',callback);
  app.post('/api/payments/webpay/return',callback);

  app.get('/api/admin/orders/:id/payments',requireAdmin,handler(async(req,res)=>{
    if(!validId(req.params.id))throw fail('ID no válido.',400);
    const payments=(await pool.query('SELECT id,mode,state,buy_order,amount_clp,bank_status,response_code,authorization_code,card_last4,created_at,updated_at,last_error FROM webpay_payments WHERE order_id=$1 ORDER BY created_at DESC',[req.params.id])).rows;
    const mp=(await pool.query(`SELECT c.id,c.mode,c.state,c.preference_id AS buy_order,c.amount_clp,p.provider_status AS bank_status,
      c.created_at,c.updated_at,c.last_error,p.payment_id,p.card_last4,c.settled_payment_id
      FROM mercadopago_checkouts c LEFT JOIN LATERAL(SELECT payment_id,provider_status,card_last4 FROM mercadopago_payments WHERE checkout_id=c.id ORDER BY (payment_id=c.settled_payment_id) DESC,observed_at DESC LIMIT 1)p ON TRUE WHERE c.order_id=$1`,[req.params.id])).rows;
    res.json([...payments.map(p=>({...p,provider:'webpay'})),...mp.map(p=>({...p,provider:'mercadopago'}))]);
  }));
  app.post('/api/admin/orders/:id/reconcile',requireAdmin,limited(30),handler(async(req,res)=>{
    if(!validId(req.params.id))throw fail('ID no válido.',400);
    const mp=(await pool.query('SELECT * FROM mercadopago_checkouts WHERE order_id=$1',[req.params.id])).rows[0];
    if(mp){const outcome=await reconcileMpCheckout(pool,mpClient,config,mp);return res.json({outcome,message:outcome==='paid'?'Mercado Pago confirmó el pago.':outcome==='failed'?'Mercado Pago informó un intento rechazado. La reserva se conserva para volver a intentarlo o revisar el checkout.':'El movimiento de Mercado Pago sigue pendiente de revisión. No se liberó la reserva.'});}
    const payment=(await pool.query('SELECT * FROM webpay_payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',[req.params.id])).rows[0];
    if (!payment) throw fail('Este pedido no tiene un pago del checkout actual.');
    const outcome=await reconcilePayment(pool,tx,config,payment);
    res.json({outcome,message:outcome==='paid'?'Pago confirmado.':outcome==='failed'?'Webpay confirma que el intento falló.':'El pago sigue pendiente de revisión. No se liberó la reserva.'});
  }));
  app.patch('/api/admin/orders/:id/tracking',requireAdmin,handler(async(req,res)=>{
    if(!validId(req.params.id))throw fail('ID no válido.',400);
    const trackingNumber=typeof req.body?.trackingNumber==='string'?req.body.trackingNumber.trim():'';
    const trackingUrl=typeof req.body?.trackingUrl==='string'?req.body.trackingUrl.trim():'';
    if(trackingNumber.length>100||trackingUrl.length>500)throw fail('Datos de seguimiento demasiado largos.',400);
    if(trackingUrl){let u;try{u=new URL(trackingUrl);}catch{}if(!u||u.protocol!=='https:'||u.username||u.password)throw fail('El enlace de seguimiento debe comenzar con https://.',400);}
    const result=await pool.query("UPDATE orders SET tracking_number=$2,tracking_url=$3 WHERE id=$1 AND payment_status='paid' AND delivery_method='shipping' RETURNING id",[req.params.id,trackingNumber||null,trackingUrl||null]);
    if(!result.rowCount)throw fail('Solo puedes agregar seguimiento a pedidos pagados con despacho.');
    res.json({message:'Seguimiento guardado. El cliente lo verá al consultar su pedido.'});
  }));
}
