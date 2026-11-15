import { useCallback, useEffect, useState } from 'react';
import { api, clp, getOrderAccess, openPayment } from '../lib/api';
import { useCart } from '../context/CartContext';
const labels={pending_payment:'Recibido',preparing:'En preparación',shipped:'Enviado',delivered:'Entregado',cancelled:'Cancelado',payment_review:'En revisión'};
const types={VD:'Débito',VN:'Crédito',VC:'Crédito en cuotas',SI:'Crédito en cuotas',S2:'Crédito en cuotas',NC:'Crédito en cuotas',VP:'Prepago'};
export default function OrderResult({orderId}){
  const [token]=useState(()=>getOrderAccess(orderId));
  const [order,setOrder]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const {completeOrder}=useCart();
  const load=useCallback(async()=>{if(!token){setError('Abre el enlace privado de tu pedido desde el comprobante o el correo de confirmación.');return;}try{const o=await api(`/api/orders/${orderId}`,{headers:{Authorization:`Bearer ${token}`}});setOrder(o);setError('');}catch(e){setError(e.message);}},[orderId,token]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{if(!order||order.paymentStatus==='paid'||order.status==='cancelled')return;let count=0;const t=setInterval(()=>{if(++count>60)clearInterval(t);else load();},5000);return()=>clearInterval(t);},[order?.paymentStatus,order?.status,load]);
  useEffect(()=>{if(order?.paymentStatus==='paid')completeOrder(order.id,order.items);if(order?.status==='cancelled'){try{const a=JSON.parse(localStorage.getItem('malfi_checkout_attempt')||'null');if(String(a?.orderId)===String(order.id))localStorage.removeItem('malfi_checkout_attempt');}catch{}}},[order?.id,order?.paymentStatus,order?.status]);
  async function pay(){setBusy(true);setError('');try{openPayment(await api(`/api/orders/${orderId}/pay`,{method:'POST',headers:{Authorization:`Bearer ${token}`}}));}catch(e){setError(e.message);setBusy(false);load();}}
  const paid=order?.paymentStatus==='paid',review=order?.status==='payment_review'||order?.requiresPaymentReview,failed=order?.payment?.state==='failed';
  const providerName=order?.paymentProvider==='mercadopago'?'Mercado Pago':'Webpay';
  const refunded=order?.paymentStatus==='refunded';
  return <main className="content-page receipt"><span className="eyebrow">MALFI · TU PEDIDO</span><h1>{refunded?'Tu pago fue reembolsado':paid?(review?'Estamos revisando tu pedido':'Gracias por elegir MALFI'):failed?'Tu pago fue rechazado':order?.status==='cancelled'?'La reserva terminó':'Revisa el estado de tu compra'}</h1>
    {error&&<p role="alert" className="notice error">{error}</p>}
    {!order&&!error&&<p role="status">Consultando pedido…</p>}
    {order&&<><p className="lead">Pedido #{order.id} · {labels[order.status]||order.status}</p>
      {order.mode==='integration'&&<p className="notice">Compra de prueba. No hubo un cobro real.</p>}
      <p className="notice" role="status">{refunded?'Mercado Pago informó el reembolso del pago. Contáctanos si necesitas ayuda.':paid?(review?'La plataforma confirmó el pago. Estamos revisando la disponibilidad antes de preparar tu pedido. Contáctanos con este número de pedido.':'Pago confirmado. Guardamos tu compra y enviaremos la confirmación al correo que ingresaste.'):order.status==='cancelled'?'Este pedido no puede pagarse. Puedes volver a la tienda para crear una nueva compra.':failed?'La plataforma confirmó que este intento no fue aprobado. Puedes intentarlo nuevamente mientras tu reserva esté vigente.':'El pago todavía no está confirmado. Si interrumpiste el proceso o ya viste un cargo, espera el resultado y consulta este pedido antes de realizar otra compra.'}</p>
      <div className="receipt-grid"><section><h2>Detalle de compra</h2>{order.items.map(i=><div className="receipt-row" key={i.product_id}><span>{i.product_name} × {i.quantity}</span><strong>{clp(i.line_total_clp)}</strong></div>)}<div className="receipt-row"><span>Subtotal</span><strong>{clp(order.subtotal)}</strong></div><div className="receipt-row"><span>Despacho · {order.carrier}</span><strong>{clp(order.shipping)}</strong></div><div className="receipt-row total"><span>Total</span><strong>{clp(order.total)} CLP</strong></div></section>
      <section><h2>Pago y entrega</h2><p>Comuna: {order.comuna}</p>{order.deliveryDaysMax&&<p>Entrega estimada: {order.deliveryDaysMin} a {order.deliveryDaysMax} días hábiles desde la confirmación del pago.</p>}
      {(paid||refunded)&&order.payment&&<><p>Plataforma: {providerName}</p><p>{providerName==='Webpay'?'Orden Webpay':'ID de pago'}: {order.payment.buy_order||order.payment.payment_id||order.payment.reference}</p>{providerName==='Webpay'&&<p>Código de autorización: {order.payment.authorization_code||'En revisión'}</p>}<p>Medio de pago: {types[order.payment.payment_type_code]||order.payment.payment_method_id||order.payment.payment_type_code||'Tarjeta'}{order.payment.card_last4?` · **** ${order.payment.card_last4}`:''}</p><p>Fecha: {new Date(order.payment.bank_transaction_date||order.paidAt).toLocaleString('es-CL',{timeZone:'America/Santiago'})}</p></>}
      {order.trackingNumber&&<p>Seguimiento: {order.trackingNumber}</p>}{order.trackingUrl&&<a className="text-link" target="_blank" rel="noreferrer" href={order.trackingUrl}>Seguir despacho</a>}
      {!paid&&!refunded&&order.canPay&&<button className="primary-button" disabled={busy} onClick={pay}>{busy?'Preparando…':failed?'Intentar pago nuevamente':`Continuar a ${providerName}`}</button>}
      <button className="secondary-button" onClick={load}>Actualizar estado</button></section></div>
      <div className="receipt-actions"><button className="secondary-button" onClick={()=>window.print()}>Guardar o imprimir comprobante</button><a className="text-link" href="/#tienda">Volver a la colección</a></div>
      <p className="muted">Conserva el enlace de esta página: es privado y permite consultar tu pedido. Este comprobante no reemplaza la boleta o factura tributaria.</p>
    </>}
  </main>;
}
