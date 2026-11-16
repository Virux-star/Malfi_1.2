export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
export async function api(path, options={}) {
  const response=await fetch(`${API_URL}${path}`,{credentials:'include',...options});
  const data=await response.json().catch(()=>({error:'No se pudo leer la respuesta. Intenta nuevamente.'}));
  if(!response.ok)throw new Error(data.error||'No se pudo completar la solicitud.');
  return data;
}
export const clp=value=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(value));
export function openWebpay(payment) {
  const url=new URL(payment.url);
  if(url.protocol!=='https:'||!['webpay3gint.transbank.cl','webpay3g.transbank.cl'].includes(url.hostname))throw new Error('La dirección de pago no es válida.');
  const form=document.createElement('form');form.method='POST';form.action=payment.url;
  const input=document.createElement('input');input.type='hidden';input.name='token_ws';input.value=payment.token;form.append(input);document.body.append(form);form.submit();
}
export function saveOrderAccess(id,token) {
  try{sessionStorage.setItem(`malfi_order_${id}`,token);}catch{/* The fragment remains a fallback for blocked storage. */}
}
export function getOrderAccess(id) {
  const token=new URLSearchParams(window.location.hash.slice(1)).get('token');
  if(token){saveOrderAccess(id,token);return token;}
  try{return sessionStorage.getItem(`malfi_order_${id}`)||'';}catch{return '';}
}
export function openPayment(payment) {
  if(payment.provider==='flow') {
    const u=new URL(payment.url);
    const hosts=payment.mode==='production'?['www.flow.cl','flow.cl','api.flow.cl']:payment.mode==='integration'?['sandbox.flow.cl']:[];
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!hosts.includes(u.hostname)||!/^[A-Za-z0-9_-]{10,200}$/.test(u.searchParams.get('token')||''))throw new Error('La dirección de Flow no es válida.');
    window.location.assign(u.toString());return;
  }
  if(payment.provider!=='mercadopago')return openWebpay(payment);
  const u=new URL(payment.url);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.mercadopago.cl','www.mercadopago.com','sandbox.mercadopago.cl','sandbox.mercadopago.com'].includes(u.hostname))throw new Error('La dirección de Mercado Pago no es válida.');
  window.location.assign(u.toString());
}
