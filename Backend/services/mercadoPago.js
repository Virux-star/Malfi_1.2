import { randomUUID, createHmac } from 'node:crypto';
import { digest, fail } from './payments.js';
import { providerAvailable } from '../config/paymentProviders.js';

export const mpReturnState=(id,config)=>createHmac('sha256',config.secret).update(`malfi-mp-return:${id}`).digest('hex');
export const mpId=id=>typeof id==='string' && /^[1-9]\d{0,19}$/.test(id);
export function mercadoPagoUrlAllowed(value,mode) {
  try {
    const u=new URL(value);
    const hosts=mode==='production'?['www.mercadopago.cl','www.mercadopago.com']:['www.mercadopago.cl','www.mercadopago.com','sandbox.mercadopago.cl','sandbox.mercadopago.com'];
    return u.protocol==='https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port;
  } catch {return false;}
}
export function integerCLP(value) {
  const s=String(value??'');
  if(!/^\d+(?:\.0+)?$/.test(s))return null;
  const amount=Number(s);return Number.isSafeInteger(amount)?amount:null;
}
export async function verifyMpSeller(client,config) {
  const seller=await client.getSeller();
  if(String(seller.id)!==config.mpCollectorId||seller.site_id!=='MLC')throw fail('El Access Token no corresponde al vendedor de Chile configurado en MP_COLLECTOR_ID.',503);
  if(!Array.isArray(seller.tags))throw fail('No se pudo verificar el ambiente de la cuenta de Mercado Pago.',503);
  const test=seller.tags.includes('test_user');
  if((config.mpMode==='integration')!==test)throw fail(config.mpMode==='integration'?'Usa las credenciales de la cuenta vendedora de prueba de Chile. No se creó un checkout con la cuenta real.':'La cuenta de prueba no puede utilizarse para cobrar en producción.',503);
  return seller;
}
export function preferenceMatches(pref,a) {
  return String(pref.id)===a.preference_id && String(pref.collector_id)===a.collector_id && pref.external_reference===a.external_reference;
}

export async function startMercadoPago(pool,client,config,id) {
  if(!client||!providerAvailable(config,'mercadopago'))throw fail('Mercado Pago no está disponible en este momento.',503);
  await verifyMpSeller(client,config);
  const db=await pool.connect();let a,order,items;
  try {
    await db.query('BEGIN');
    order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!order||order.payment_provider!=='mercadopago'||order.payment_mode!==config.mpMode)throw fail('Este pedido corresponde a otro medio o ambiente de pago.');
    if(order.status!=='pending_payment'||order.payment_status!=='pending'||!order.inventory_reserved||new Date(order.expires_at)<=new Date())throw fail('La reserva ya no está disponible para pagar.');
    const other=await db.query('SELECT 1 FROM webpay_payments WHERE order_id=$1 UNION ALL SELECT 1 FROM webpay_test_attempts WHERE order_id=$1 UNION ALL SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1',[id]);
    if(other.rowCount)throw fail('Este pedido tiene un intento de otra integración que requiere revisión.');
    const current=(await db.query('SELECT * FROM mercadopago_checkouts WHERE order_id=$1',[id])).rows[0];
    if(current) {
      if(current.mode===config.mpMode && current.collector_id===config.mpCollectorId && current.state==='created' && current.checkout_url && current.preference_id && new Date(current.preference_expires_at)>new Date()) {
        await db.query('COMMIT');return {provider:'mercadopago',url:current.checkout_url};
      }
      throw fail('Estamos verificando el intento anterior de Mercado Pago. Consulta tu pedido antes de volver a pagar.');
    }
    a={id:randomUUID(),order_id:String(id),mode:config.mpMode,collector_id:config.mpCollectorId,amount_clp:Number(order.total_clp)};
    a.external_reference=`malfi_${id}_${a.id}`;
    items=(await db.query('SELECT product_id,product_name,unit_price_clp,quantity FROM order_items WHERE order_id=$1 ORDER BY id',[id])).rows;
    if(!items.length)throw fail('El pedido no tiene productos.');
    await db.query(`INSERT INTO mercadopago_checkouts(id,order_id,mode,amount_clp,external_reference,collector_id,return_state_hash,preference_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.id,id,a.mode,a.amount_clp,a.external_reference,a.collector_id,digest(mpReturnState(a.id,config)),order.expires_at]);
    await db.query('COMMIT');
  } catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  try {
    const back=`${config.mpPublicOrigin}/api/payments/mercadopago/return?state=${mpReturnState(a.id,config)}`;
    const preferenceItems=items.map(i=>({id:String(i.product_id),title:i.product_name,quantity:i.quantity,unit_price:i.unit_price_clp,currency_id:'CLP'}));
    if(order.shipping_clp>0)preferenceItems.push({id:'shipping',title:`Despacho · ${order.carrier}`,quantity:1,unit_price:order.shipping_clp,currency_id:'CLP'});
    const preference=await client.createPreference({items:preferenceItems,external_reference:a.external_reference,
      metadata:{malfi_order_id:String(id),malfi_attempt_id:a.id,malfi_mode:a.mode},
      back_urls:{success:back,pending:back,failure:back},auto_return:'approved',
      notification_url:`${config.mpPublicOrigin}/api/payments/mercadopago/webhook`,
      expires:true,expiration_date_from:new Date().toISOString(),expiration_date_to:new Date(order.expires_at).toISOString(),
      binary_mode:true,statement_descriptor:'MALFI'});
    const preferenceId=String(preference.id||'');
    const url=preference.init_point || (a.mode==='integration'?preference.sandbox_init_point:null);
    if(!/^[A-Za-z0-9_-]{5,180}$/.test(preferenceId)||!preferenceMatches(preference,{...a,preference_id:preferenceId})||!mercadoPagoUrlAllowed(url,a.mode))throw new Error('Preferencia no válida.');
    await pool.query(`UPDATE mercadopago_checkouts SET preference_id=$2,checkout_url=$3,
      state=CASE WHEN state='starting' OR (state='review' AND last_error='Creación sin resultado confirmado.') THEN 'created' ELSE state END,
      updated_at=now() WHERE id=$1`,[a.id,preferenceId,url]);
    return {provider:'mercadopago',url};
  } catch(e) {
    await pool.query("UPDATE mercadopago_checkouts SET state='review',last_error='Creación sin resultado confirmado.',updated_at=now() WHERE id=$1 AND state='starting'",[a.id]);
    throw fail('No pudimos confirmar el inicio de Mercado Pago. Conservamos el pedido para revisarlo; evita repetir la compra.',502);
  }
}

// Every event is re-read with the private server token. URL/body statuses never authorize a sale.
export async function readCanonicalMpPayment(pool,client,config,paymentId) {
  if(!client||!mpId(String(paymentId)))throw fail('Identificador de pago no válido.',400);
  const p=await client.getPayment(String(paymentId));
  if(String(p.id)!==String(paymentId))throw fail('Mercado Pago devolvió otro pago.');
  const reference=typeof p.external_reference==='string'?p.external_reference:'';
  if(reference.length>160)throw fail('Referencia no válida.');
  const a=(await pool.query('SELECT * FROM mercadopago_checkouts WHERE external_reference=$1',[reference])).rows[0];
  if(!a)return null;
  if(a.mode!==config.mpMode||a.collector_id!==config.mpCollectorId||String(p.collector_id)!==a.collector_id||p.currency_id!=='CLP'||p.live_mode!==(a.mode==='production')||integerCLP(p.transaction_amount)!==Number(a.amount_clp))throw fail('El vendedor, ambiente, moneda o monto de Mercado Pago no coincide.');
  const merchantId=String(p.order?.id||'');
  if(!mpId(merchantId))throw fail('El pago no tiene una orden comercial verificable.');
  const merchant=await client.getMerchantOrder(merchantId);
  if(String(merchant.id)!==merchantId||merchant.external_reference!==a.external_reference||String(merchant.collector?.id)!==a.collector_id||merchant.site_id!=='MLC'||!Array.isArray(merchant.payments)||!merchant.payments.some(i=>String(i.id)===String(p.id)))throw fail('La orden comercial no coincide con el pedido.');
  const prefId=String(merchant.preference_id||'');
  if(!prefId||prefId.length>180)throw fail('La preferencia de pago no coincide.');
  if(a.preference_id && a.preference_id!==prefId)throw fail('El pago pertenece a otra preferencia.');
  if(!a.preference_id) {
    // Recover only with the canonical preference when create's HTTP response was lost.
    const pref=await client.getPreference(prefId);
    if(!preferenceMatches(pref,{...a,preference_id:prefId}))throw fail('No se pudo recuperar la preferencia de forma segura.');
    await pool.query('UPDATE mercadopago_checkouts SET preference_id=$2,updated_at=now() WHERE id=$1 AND preference_id IS NULL',[a.id,prefId]);
    a.preference_id=prefId;
  }
  if(p.metadata?.malfi_attempt_id && p.metadata.malfi_attempt_id!==a.id)throw fail('Los metadatos del pago no coinciden.');
  if(!p.date_last_updated||Number.isNaN(Date.parse(p.date_last_updated)))throw fail('El pago no tiene una fecha de actualización verificable.');
  const refunded=integerCLP(p.transaction_amount_refunded??0);
  if(refunded===null||refunded>Number(a.amount_clp))throw fail('El monto reembolsado no es válido.');
  return {checkout:a,payment:p,merchantId,refunded};
}

export async function applyMpPayment(pool,verified) {
  if(!verified)return 'ignored';
  const {checkout:a,payment:p,merchantId,refunded}=verified;
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[a.order_id])).rows[0];
    const current=(await db.query('SELECT * FROM mercadopago_checkouts WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
    if(!order||!current||order.payment_provider!=='mercadopago'||order.payment_mode!==current.mode||Number(order.total_clp)!==Number(a.amount_clp)||current.preference_id!==a.preference_id||current.collector_id!==a.collector_id)throw fail('El pedido cambió durante la confirmación de Mercado Pago.');
    const existing=(await db.query('SELECT * FROM mercadopago_payments WHERE payment_id=$1 FOR UPDATE',[String(p.id)])).rows[0];
    if(existing&&existing.checkout_id!==a.id)throw fail('El pago ya está vinculado a otro pedido.');
    if(existing && new Date(existing.provider_updated_at)>new Date(p.date_last_updated)){await db.query('COMMIT');return current.state==='paid'?'paid':current.state==='review'?'review':'pending';}
    await db.query(`INSERT INTO mercadopago_payments(payment_id,checkout_id,merchant_order_id,provider_status,status_detail,amount_clp,refunded_clp,live_mode,payment_method_id,payment_type_id,card_last4,approved_at,provider_updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(payment_id) DO UPDATE SET provider_status=excluded.provider_status,status_detail=excluded.status_detail,refunded_clp=excluded.refunded_clp,approved_at=excluded.approved_at,provider_updated_at=excluded.provider_updated_at,observed_at=now()`,[
        String(p.id),a.id,merchantId,String(p.status||'unknown').slice(0,40),String(p.status_detail||'').slice(0,100),a.amount_clp,refunded,p.live_mode,
        String(p.payment_method_id||'').slice(0,40),String(p.payment_type_id||'').slice(0,40),/^\d{4}$/.test(String(p.card?.last_four_digits))?String(p.card.last_four_digits):null,
        p.date_approved&&!Number.isNaN(Date.parse(p.date_approved))?p.date_approved:null,p.date_last_updated
      ]);
    const approved=p.status==='approved'&&p.status_detail==='accredited'&&p.captured!==false&&refunded===0;
    let outcome='pending';
    if(current.settled_payment_id===String(p.id)) {
      if(p.status==='refunded'||p.status==='charged_back'||refunded>0||p.status!=='approved') {
        await db.query("UPDATE mercadopago_checkouts SET state='review',last_error='Pago confirmado con devolución, contracargo o cambio de estado. Revisar en Mercado Pago.',updated_at=now() WHERE id=$1",[a.id]);
        await db.query(`UPDATE orders SET payment_status=CASE WHEN $2 THEN 'refunded' ELSE payment_status END,
          status=CASE WHEN status IN ('pending_payment','preparing') THEN 'payment_review' ELSE status END WHERE id=$1`,[order.id,p.status==='refunded'&&refunded===Number(a.amount_clp)]);
        outcome='review';
      } else outcome=current.state==='review'?'review':'paid';
    } else if(approved) {
      const otherMovements=await db.query("SELECT 1 FROM mercadopago_payments WHERE checkout_id=$1 AND payment_id<>$2 AND (refunded_clp>0 OR provider_status IN ('approved','authorized','refunded','charged_back','in_mediation')) LIMIT 1",[a.id,String(p.id)]);
      if(order.payment_status==='paid'||current.settled_payment_id||otherMovements.rowCount) {
        await db.query("UPDATE mercadopago_checkouts SET state='review',last_error='Otra autorización para el mismo pedido: revisar y gestionar el cobro duplicado.',updated_at=now() WHERE id=$1",[a.id]);
        await db.query("UPDATE orders SET status=CASE WHEN status IN ('pending_payment','preparing') THEN 'payment_review' ELSE status END WHERE id=$1",[order.id]);
        outcome='review';
      } else {
        const items=(await db.query('SELECT product_id,SUM(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id',[order.id])).rows;
        const products=(await db.query('SELECT id,stock,reserved_stock FROM products WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[items.map(i=>i.product_id)])).rows;
        const byId=new Map(products.map(i=>[i.id,i]));
        const fulfill=order.status==='pending_payment'&&order.payment_status==='pending'&&order.inventory_reserved&&!order.stock_deducted_at&&items.length>0&&items.every(i=>{const stock=byId.get(i.product_id);return stock&&stock.stock>=i.quantity&&stock.reserved_stock>=i.quantity;});
        if(fulfill)for(const i of items)await db.query('UPDATE products SET stock=stock-$1,reserved_stock=reserved_stock-$1 WHERE id=$2',[i.quantity,i.product_id]);
        await db.query(`UPDATE orders SET payment_status='paid',status=$2,paid_at=COALESCE(paid_at,now()),
          inventory_reserved=CASE WHEN $3 THEN FALSE ELSE inventory_reserved END,stock_deducted_at=CASE WHEN $3 THEN now() ELSE stock_deducted_at END WHERE id=$1`,[order.id,fulfill?'pending_payment':'payment_review',fulfill]);
        await db.query("UPDATE mercadopago_checkouts SET state=$2,settled_payment_id=$3,last_error=$4,updated_at=now() WHERE id=$1",[a.id,fulfill?'paid':'review',String(p.id),fulfill?null:'Pago recibido: revisar inventario antes de preparar.']);
        if(fulfill)await db.query("INSERT INTO order_email_outbox(order_id,kind,template_version) VALUES($1,'payment_confirmed',2),($1,'admin_new_order',2) ON CONFLICT(order_id,kind) DO NOTHING",[order.id]);
        outcome=fulfill?'paid':'review';
      }
    } else if(!current.settled_payment_id && order.payment_status!=='paid') {
      const problem=(await db.query("SELECT 1 FROM mercadopago_payments WHERE checkout_id=$1 AND (refunded_clp>0 OR provider_status IN ('refunded','charged_back','authorized','in_mediation')) LIMIT 1",[a.id])).rowCount>0;
      const pending=(await db.query("SELECT 1 FROM mercadopago_payments WHERE checkout_id=$1 AND provider_status NOT IN ('rejected','cancelled') LIMIT 1",[a.id])).rowCount>0;
      await db.query(`UPDATE mercadopago_checkouts SET state=$2,last_error=$3,updated_at=now() WHERE id=$1`,[a.id,problem?'review':pending?'pending':'created',problem?'El movimiento requiere revisión en Mercado Pago.':null]);
      outcome=problem?'review':pending?'pending':'failed';
    }
    await db.query('UPDATE mercadopago_checkouts SET last_reconciled_at=now() WHERE id=$1',[a.id]);
    await db.query('COMMIT');return outcome;
  } catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export async function processMpPayment(pool,client,config,paymentId) {
  return applyMpPayment(pool,await readCanonicalMpPayment(pool,client,config,paymentId));
}
export async function reconcileMpCheckout(pool,client,config,a) {
  if(!client||a.mode!==config.mpMode||a.collector_id!==config.mpCollectorId)throw fail('El ambiente o la cuenta de Mercado Pago cambió. Revisa la configuración.');
  let offset=0,total=0,outcome='pending';
  do {
    const result=await client.searchPayments(a.external_reference,offset);
    if(!Array.isArray(result.results)||!Number.isSafeInteger(Number(result.paging?.total)))throw fail('No se pudo revisar la lista de pagos de Mercado Pago.',502);
    total=Number(result.paging.total);
    if(total>200)throw fail('Este pedido tiene demasiados movimientos. Revisa el reporte de Mercado Pago.');
    for(const p of result.results) {
      if(p.external_reference!==a.external_reference||!mpId(String(p.id)))throw fail('Mercado Pago devolvió referencias distintas durante la revisión.');
      const current=await processMpPayment(pool,client,config,String(p.id));
      if(current==='review'||(current==='paid'&&outcome!=='review')||outcome==='pending')outcome=current;
    }
    offset+=result.results.length;
    if(!result.results.length)break;
  }while(offset<total);
  const latest=(await pool.query('SELECT state FROM mercadopago_checkouts WHERE id=$1',[a.id])).rows[0];
  await pool.query('UPDATE mercadopago_checkouts SET last_reconciled_at=now() WHERE id=$1',[a.id]);
  if(latest?.state==='paid')return 'paid';
  if(latest?.state==='review')return 'review';
  // Neither an expired link nor an empty search proves absence of an in-flight payment.
  return outcome;
}
