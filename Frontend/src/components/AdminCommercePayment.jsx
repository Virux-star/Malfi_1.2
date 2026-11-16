import { useEffect, useState } from 'react';
import { api, clp } from '../lib/api';
export default function AdminCommercePayment({order}){
  const [payments,setPayments]=useState([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [trackingNumber,setTrackingNumber]=useState(order.tracking_number||''),[trackingUrl,setTrackingUrl]=useState(order.tracking_url||'');
  async function load(){setPayments(await api(`/api/admin/orders/${order.id}/payments`));}
  useEffect(()=>{load().catch(e=>setError(e.message));},[order.id]);
  async function reconcile(){setBusy(true);setError('');try{const r=await api(`/api/admin/orders/${order.id}/reconcile`,{method:'POST'});setMessage(r.message);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function save(e){e.preventDefault();setBusy(true);setError('');try{const r=await api(`/api/admin/orders/${order.id}/tracking`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackingNumber,trackingUrl})});setMessage(r.message);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section style={{marginTop:25,borderTop:'1px solid #d8c9b9',paddingTop:20}}><h4>Pagos del cliente</h4>{!payments.length?<p>Sin intentos en el checkout actual.</p>:payments.map(p=><div key={p.id} style={{margin:'15px 0',overflowWrap:'anywhere'}}><p>{p.mode==='production'?'Producción':'Prueba'} · {p.state} · {clp(p.amount_clp)}</p><p>{p.provider==='flow'?'Orden Flow':p.provider==='mercadopago'?'Preferencia Mercado Pago':'Orden Webpay'}: {p.buy_order||'En revisión'}{p.payment_id?` · Pago ${p.payment_id}`:''}</p><p>{p.provider==='flow'?'Estado informado':'Banco'}: {p.provider==='flow'?({1:'Pendiente',2:'Pagado',3:'Rechazado',4:'Anulado'}[p.bank_status]||'Sin confirmar'):p.bank_status||'Sin confirmar'}{p.authorization_code?` · Autorización ${p.authorization_code}`:''}</p>{p.last_error&&<p>{p.last_error}</p>}</div>)}
    {payments.length>0&&<button className="secondary-button" onClick={reconcile} disabled={busy}>Consultar y conciliar el pago</button>}
    {order.payment_status==='paid'&&order.delivery_method!=='pickup'&&<form className="admin-form" onSubmit={save}><h4>Seguimiento del despacho</h4><label>Número de envío<input maxLength={100} value={trackingNumber} onChange={e=>setTrackingNumber(e.target.value)}/></label><label>Enlace HTTPS del transportista<input type="url" maxLength={500} placeholder="https://…" value={trackingUrl} onChange={e=>setTrackingUrl(e.target.value)}/></label><button className="secondary-button" disabled={busy}>Guardar seguimiento</button></form>}
    {message&&<p role="status">{message} Actualiza el detalle del pedido para ver su estado.</p>}{error&&<p role="alert" className="checkout-error">{error}</p>}
  </section>;
}
