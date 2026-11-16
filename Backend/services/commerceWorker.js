import { reconcileMpCheckout } from './mercadoPago.js';
import { Resend } from 'resend';
import { compactOrderEmail } from './compactOrderEmail.js';
import { reconcilePayment, releaseExpiredOrders, orderToken } from './payments.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clp=n=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(n));
export function orderEmail(kind,order,items,config) {
  const business=order.business_snapshot||{};
  const pickup=order.delivery_method==='pickup';
  const admin=kind==='admin_new_order';
  const test=order.payment_mode!=='production';
  const url=`${config.origin}/pedido/${order.id}#token=${orderToken(order.checkout_key,config)}`;
  const title=admin?'Nuevo pedido pagado':'Tu compra está confirmada';
  const text=[`MALFI${test?' · PRUEBA SIN COBRO REAL':''}`,title,`Pedido #${order.id}`,`Cliente: ${order.customer_name}`,
    ...items.map(i=>`${i.product_name} · ${i.quantity} × ${clp(i.unit_price_clp)} = ${clp(i.line_total_clp)}`),
    `Subtotal: ${clp(order.subtotal_clp)}`,pickup?'Retiro en tienda: Sin costo':`Despacho ${order.carrier}: ${Number(order.shipping_clp)===0?'Gratis':clp(order.shipping_clp)}`,`Total pagado: ${clp(order.total_clp)} CLP`,
    `${pickup?'Retiro en tienda':'Entrega'}: ${order.shipping_address}, ${order.shipping_comuna}, ${order.shipping_region}`,
    pickup?`Preparación estimada: hasta ${order.delivery_days_max} día(s) hábil(es) desde el pago. Revisa el estado en tu pedido y coordina el retiro con MALFI antes de ir.`:`Plazo total estimado: ${order.delivery_days_min} a ${order.delivery_days_max} días hábiles desde el pago.`,
    `Consulta y seguimiento: ${url}`,'',`Proveedor: ${business.legalName} · RUT ${business.rut}`,
    `Domicilio legal: ${business.legalAddress}`,`Contacto: ${business.email} · ${business.phone}`,
    `Condiciones aceptadas: ${order.terms_version}`,
    pickup?'Los precios se expresan en pesos chilenos e incluyen los impuestos aplicables. Elegiste retiro en tienda sin costo en la dirección informada en este comprobante. El plazo de preparación informado forma parte del pedido. Coordina el retiro con MALFI cuando el pedido esté listo.':'Los precios se expresan en pesos chilenos e incluyen los impuestos aplicables. El despacho se realiza desde Las Condes. Paket atiende los destinos con cobertura de Santiago confirmada; Blue Express atiende los demás destinos habilitados. El costo y plazo informados forman parte del pedido.',
    'Puedes ejercer el retracto dentro de 10 días desde que recibes el producto, conforme a la normativa aplicable. Si un producto nuevo tiene defectos, puedes elegir reparación, cambio o devolución dentro de los 6 meses desde su recepción, cuando corresponda la garantía legal.',
    business.returnsInstructions,
    'Usamos tus datos para gestionar esta compra, su pago, entrega y atención posterior. Se comunican a los proveedores de pago, despacho y correo necesarios para esos fines. No se utiliza esta compra como consentimiento para publicidad. Puedes dirigir consultas sobre tus datos al correo del negocio.',
    'Este comprobante de compra no reemplaza la boleta o factura tributaria que debe emitir el comercio.'
  ].join('\n');
  return {subject:`MALFI · ${title} #${order.id}${test?' [PRUEBA]':''}`,text,
    html:`<div style="font-family:Arial,sans-serif;background:#faf8f5;color:#49382e;padding:32px"><div style="max-width:600px;margin:auto;background:white;padding:32px"><h1 style="font-family:Georgia,serif;font-weight:normal">MALFI</h1><h2>${escape(title)}</h2><p style="line-height:1.8;white-space:pre-line">${escape(text)}</p><p><a href="${escape(url)}">Consultar mi pedido</a></p></div></div>`};
}

export async function sendEmailsOnce(pool,config,provider) {
  if (!['test','production'].includes(config.emailMode)) return;
  const resend=provider||new Resend(process.env.RESEND_API_KEY);
  // Uncertain sends can be retried with the same provider key for up to 24h.
  await pool.query(`UPDATE order_email_outbox SET status='queued',next_attempt_at=now() WHERE status='sending' AND started_at<now()-interval '10 minutes' AND started_at>now()-interval '23 hours' AND attempts<5`);
  await pool.query(`UPDATE order_email_outbox SET status='needs_review' WHERE status IN ('sending','queued') AND attempts>0 AND started_at<now()-interval '23 hours'`);
  const rows=(await pool.query(`SELECT e.order_id,e.kind,e.template_version FROM order_email_outbox e JOIN orders o ON o.id=e.order_id
    WHERE e.status='queued' AND e.next_attempt_at<=now() AND e.attempts<5 AND o.payment_status='paid' AND o.status<>'payment_review'
      AND o.checkout_key IS NOT NULL AND o.stock_deducted_at IS NOT NULL AND o.inventory_reserved=FALSE
      AND o.payment_mode=$1 ORDER BY e.created_at LIMIT 20`,[config.emailMode==='production'?'production':'integration'])).rows;
  for(const r of rows) {
    const claimed=await pool.query(`UPDATE order_email_outbox SET status='sending',attempts=attempts+1,started_at=COALESCE(started_at,now()) WHERE order_id=$1 AND kind=$2 AND status='queued' RETURNING attempts,started_at`,[r.order_id,r.kind]);
    if(!claimed.rowCount)continue;
    try {
      const order=(await pool.query('SELECT * FROM orders WHERE id=$1',[r.order_id])).rows[0];
      const items=(await pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id',[r.order_id])).rows;
      const to=config.emailMode==='test'?process.env.EMAIL_TEST_TO:r.kind==='admin_new_order'?process.env.ADMIN_EMAIL:order.customer_email;
      if(!to)throw new Error('Destinatario no configurado.');
      const original=orderEmail(r.kind,order,items,config);
      const email=r.template_version===2?compactOrderEmail(r.kind,order,items,config,original.text):original;
      const result=await resend.emails.send({from:config.emailMode==='test'?'MALFI Pruebas <onboarding@resend.dev>':process.env.EMAIL_FROM,to:[to],replyTo:order.business_snapshot?.email,...email}, {idempotencyKey:`malfi-${order.payment_mode}-${r.kind}-${r.order_id}-v${r.template_version||1}`});
      if(result.error||!result.data?.id)throw new Error('El proveedor no confirmó el envío.');
      await pool.query("UPDATE order_email_outbox SET status='sent',provider_id=$3,sent_at=now(),last_error=NULL WHERE order_id=$1 AND kind=$2 AND status='sending'",[r.order_id,r.kind,result.data.id]);
    } catch(e) {
      const c=claimed.rows[0],withinWindow=Date.now()-new Date(c.started_at)<23*60*60_000;
      await pool.query("UPDATE order_email_outbox SET status=$3,last_error=$4,next_attempt_at=now()+interval '10 minutes' WHERE order_id=$1 AND kind=$2 AND status='sending'",[r.order_id,r.kind,c.attempts<5&&withinWindow?'queued':'needs_review',String(e.message).slice(0,300)]);
    }
  }
}
export async function commerceCycle(pool,config,tx,{emailProvider,mercadoPagoClient}={}) {
  if (tx) {
    const payments=(await pool.query(`SELECT * FROM webpay_payments WHERE mode=$1 AND state IN ('starting','created','processing','authorized','review') AND finalized_at IS NULL AND updated_at<now()-interval '60 seconds' ORDER BY updated_at LIMIT 30`,[config.mode])).rows;
    for (const p of payments) {
      if (Date.now()-new Date(p.created_at)>6*24*60*60_000) {
        await pool.query("UPDATE webpay_payments SET state='review',last_error='Consultar el reporte de Transbank antes de resolver este pago.',updated_at=now() WHERE id=$1",[p.id]);
        continue;
      }
      try {await reconcilePayment(pool,tx,config,p);}catch(e){console.error('Conciliación de pago:',p.id,e.message);}
    }
  }
  if(mercadoPagoClient && config.mpMode!=='disabled') {
    const checkouts=(await pool.query(`SELECT * FROM mercadopago_checkouts WHERE mode=$1 AND (last_reconciled_at IS NULL OR last_reconciled_at<now()-interval '60 seconds') AND created_at>now()-interval '7 days' ORDER BY last_reconciled_at NULLS FIRST,created_at LIMIT 30`,[config.mpMode])).rows;
    for(const checkout of checkouts){try{await reconcileMpCheckout(pool,mercadoPagoClient,config,checkout);}catch(e){console.error('Revisión Mercado Pago:',checkout.id,e.message);}}
  }
  await releaseExpiredOrders(pool);
  await sendEmailsOnce(pool,config,emailProvider);
}
export function startCommerceWorker(pool,config,tx,mercadoPagoClient) {
  let running=false,stopped=false;
  const run=async()=>{if(running||stopped)return;running=true;try{await commerceCycle(pool,config,tx,{mercadoPagoClient});}catch(e){console.error('Revisión de pedidos:',e.message);}finally{running=false;}};
  void run();const timer=setInterval(()=>void run(),60_000);timer.unref();
  return ()=>{stopped=true;clearInterval(timer);};
}
