import { useEffect, useState } from 'react';
import { useCart } from '../context/CartContext';
import { useStore } from '../context/StoreContext';
import { api, clp, openPayment, saveOrderAccess } from '../lib/api';
import './Checkout.css';

export default function Checkout() {
  const {items}=useCart(),{store,error:storeError}=useStore();
  const [quote,setQuote]=useState(null),[destinations,setDestinations]=useState([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[created,setCreated]=useState(null);
  const [selectedProvider,setSelectedProvider]=useState('mercadopago');
  const [deliveryMethod,setDeliveryMethod]=useState('shipping');
  const pickup=deliveryMethod==='pickup'&&store?.pickup?.enabled;
  const providers=store?.paymentProviders || [];
  const provider=providers.find(p=>p.id===selectedProvider)||providers[0];
  const [form,setForm]=useState({fullName:'',email:'',phone:'',region:'',comuna:'',address:'',reference:''});
  useEffect(()=>{
    const c=new AbortController();
    api('/api/shipping/destinations',{signal:c.signal}).then(setDestinations).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>c.abort();
  },[]);
  useEffect(()=>{
    const c=new AbortController();setQuote(null);setError('');
    if(items.length)api('/api/checkout/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items.map(i=>({id:i.id,quantity:i.quantity}))}),signal:c.signal}).then(setQuote).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>c.abort();
  },[items]);
  const regions=(store?.regions||[]).filter(r=>destinations.some(d=>d.region===r));
  const comunas=destinations.filter(d=>d.region===form.region);
  const shipping=comunas.find(d=>d.comuna===form.comuna);
  const deliveryAvailable=pickup||!!shipping;
  const total=quote&&deliveryAvailable?quote.subtotal+(pickup?0:shipping.price_clp):null;
  function change(e){const {name,value}=e.target;setForm(old=>({...old,[name]:value,...(name==='region'?{comuna:''}:{})}));}
  async function submit(e){
    e.preventDefault();if(busy||!deliveryAvailable||!accepted||!store?.checkoutAvailable||!quote||!provider||created)return;
    setBusy(true);setError('');
    try{
      const payload={customer:pickup?{fullName:form.fullName,email:form.email,phone:form.phone}:form,...(pickup?{deliveryMethod:'pickup'}:{}),items:items.map(i=>({id:i.id,quantity:i.quantity})),expectedTotal:total,paymentProvider:provider?.id,acceptTerms:true,termsVersion:store.business.policiesVersion};
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(x=>x.toString(16).padStart(2,'0')).join('');
      let prior;try{prior=JSON.parse(localStorage.getItem('malfi_checkout_attempt'));}catch{}
      const key=prior?.hash===hash?prior.key:crypto.randomUUID();
      try{localStorage.setItem('malfi_checkout_attempt',JSON.stringify({hash,key}));}catch{}
      const order=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
      setCreated(order);saveOrderAccess(order.orderId,order.accessToken);
      try{localStorage.setItem('malfi_checkout_attempt',JSON.stringify({hash,key,orderId:order.orderId}));}catch{}
      try{sessionStorage.setItem('malfi_last_order',String(order.orderId));}catch{}
      const payment=await api(`/api/orders/${order.orderId}/pay`,{method:'POST',headers:{Authorization:`Bearer ${order.accessToken}`}});
      openPayment(payment);
    }catch(e){setError(e.message);setBusy(false);}
  }
  if(!items.length)return <main className="checkout-empty"><h1>Tu carrito está vacío</h1><p>Elige tus favoritos para comenzar.</p><a href="/#tienda">Explorar colección</a></main>;
  return <main className="checkout-page"><div className="checkout-container">
    <header className="checkout-header"><h1>Finalizar compra</h1><p>Elige cómo recibir tu pedido.</p></header>
    {(storeError||error)&&<p role="alert" className="checkout-error">{storeError||error} <a href="/carrito">Revisar carrito</a></p>}
    {store&&!store.checkoutAvailable&&<p role="status" className="notice">Estamos preparando la tienda para recibir compras. Puedes conocer la colección y contactarnos en <a href="https://www.instagram.com/malfi.candles/" target="_blank" rel="noreferrer">Instagram</a>.</p>}
    {provider?.mode==='integration'&&<p className="notice">Ambiente de prueba: no se realizan cobros reales.</p>}
    <div className="checkout-layout"><section className="checkout-form-section"><h2>Datos de contacto y entrega</h2>
      <form id="malfi-checkout-form" className="checkout-form" onSubmit={submit}>
        <fieldset disabled={busy||!!created}>
        <fieldset className="payment-options delivery-options"><legend>Entrega del pedido</legend>
          <label className={`payment-option ${deliveryMethod==='shipping'?'selected':''}`}><input type="radio" name="deliveryMethod" value="shipping" checked={deliveryMethod==='shipping'} onChange={()=>setDeliveryMethod('shipping')}/><span><strong>Despacho a domicilio</strong><small>Costo y plazo según tu destino</small></span></label>
          {store?.pickup?.enabled&&<label className={`payment-option ${pickup?'selected':''}`}><input type="radio" name="deliveryMethod" value="pickup" checked={!!pickup} onChange={()=>setDeliveryMethod('pickup')}/><span><strong>Retiro en tienda · Sin costo</strong><small>{store.pickup.address}, {store.pickup.comuna}</small></span></label>}
        </fieldset>
        {pickup&&<div className="checkout-pickup-info" role="status"><strong>Retira en {store.pickup.address}, {store.pickup.comuna}</strong><p>Preparación estimada: hasta {store.business.preparationDays} día(s) hábil(es) desde el pago. Revisa el estado en tu pedido y coordina el retiro con MALFI antes de ir.</p></div>}
        <div className="checkout-fields">
          <label className="field-full">Nombre completo<input name="fullName" autoComplete="name" required maxLength={120} value={form.fullName} onChange={change}/></label>
          <label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={change}/></label>
          <label>Teléfono<input name="phone" type="tel" autoComplete="tel" required minLength={8} maxLength={25} placeholder="+56 9 1234 5678" value={form.phone} onChange={change}/></label>
          {!pickup&&<><label>Región<select name="region" autoComplete="address-level1" required value={form.region} onChange={change}><option value="">Selecciona tu región</option>{regions.map(r=><option key={r}>{r}</option>)}</select></label>
          <label>Comuna<select name="comuna" autoComplete="address-level2" required disabled={!form.region} value={form.comuna} onChange={change}><option value="">Selecciona tu comuna</option>{comunas.map(c=><option key={c.comuna}>{c.comuna}</option>)}</select></label>
          <label className="field-full">Dirección y número<input name="address" autoComplete="street-address" required maxLength={250} placeholder="Calle, número, casa o departamento" value={form.address} onChange={change}/></label>
          <label className="field-full">Referencia de entrega (opcional)<textarea name="reference" maxLength={300} rows={3} value={form.reference} onChange={change}/></label></>}
        </div>
        {!pickup&&<p className="checkout-form-note">Mostramos los destinos con despacho disponible. Si tu comuna no aparece, <a href="/#contacto">contáctanos</a> antes de comprar. También puedes elegir retiro en tienda sin costo.</p>}
        <fieldset className="payment-options"><legend>Forma de pago</legend>
          {providers.map(p=><label className={`payment-option ${provider?.id===p.id?'selected':''}`} key={p.id}><input type="radio" name="paymentProvider" value={p.id} checked={provider?.id===p.id} onChange={()=>setSelectedProvider(p.id)}/><span><strong>{p.label}</strong><small>{p.id==='webpay'?'Tarjetas a través de Webpay Plus':'Continúa tu compra en Mercado Pago'}{p.mode==='integration'?' · Pruebas':''}</small></span></label>)}
          {!providers.length&&<p className="muted">Los medios de pago se habilitarán al abrir las compras.</p>}
        </fieldset>
        <label className="terms-check"><input type="checkbox" required checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>He leído y acepto los <a href="/terminos" target="_blank" rel="noreferrer">términos de compra</a> y la <a href="/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.</span></label>
        </fieldset>
      </form>
    </section><aside className="checkout-summary"><h2>Tu pedido</h2>
      {!quote&&!error&&<p role="status">Verificando precios y disponibilidad…</p>}
      {quote&&<>{quote.items.map(i=><div className="checkout-product" key={i.id}>{i.image_url&&<img src={i.image_url} alt=""/>}<div className="checkout-product-info"><h3>{i.name}</h3><p>Cantidad: {i.quantity}</p><strong>{clp(i.line_total)}</strong></div></div>)}
      <div className="checkout-summary-line"><span>Subtotal</span><strong>{clp(quote.subtotal)}</strong></div>
      <div className="checkout-summary-line"><span>{pickup?'Retiro en tienda':`Despacho${shipping?` · ${shipping.carrier}`:''}`}</span><strong>{pickup?'Sin costo':shipping?clp(shipping.price_clp):'Selecciona un destino'}</strong></div>
      {pickup&&<p className="checkout-shipping-note">Retiro en {store.pickup.address}, {store.pickup.comuna}. Coordina el retiro cuando el pedido esté listo.</p>}
      {!pickup&&shipping&&<p className="checkout-shipping-note">Entrega estimada: {shipping.delivery_days_min+store.business.preparationDays} a {shipping.delivery_days_max+store.business.preparationDays} días hábiles desde el pago, incluyendo preparación.</p>}
      {total!==null&&<div className="checkout-summary-line checkout-total"><strong>Total a pagar</strong><strong>{clp(total)}</strong></div>}
      <p className="checkout-form-note">Precios en pesos chilenos, con impuestos incluidos. Completarás el pago directamente en Mercado Pago.</p>
      </>}
      <button className="checkout-pay-button" type="submit" form="malfi-checkout-form" disabled={busy||!quote||!deliveryAvailable||!accepted||!store?.checkoutAvailable||!provider||!!created}>{busy?'Preparando pago…':created?'Pedido registrado':`Pagar con ${provider?.label||'el medio elegido'}`}</button>
      {created&&<div className="checkout-order-success"><h3>Conservamos tu pedido #{created.orderId}</h3><p>Consulta su resultado antes de repetir la compra.</p><a className="text-link" href={`/pedido/${created.orderId}#token=${created.accessToken}`}>Consultar pedido y continuar</a></div>}
      <a className="checkout-back" href="/carrito">← Volver al carrito</a>
    </aside></div>
  </div></main>;
}
