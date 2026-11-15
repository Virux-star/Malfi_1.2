import { fail } from './payments.js';
const API_ORIGIN='https://api.mercadopago.com';
export function createMercadoPagoClient(config,{fetchImpl=fetch}={}) {
  if(!config.mpMode||config.mpMode==='disabled'||!config.mpAccessToken)return null;
  async function request(path,{method='GET',body}={}) {
    let response;
    try {response=await fetchImpl(`${API_ORIGIN}${path}`,{method,headers:{Authorization:`Bearer ${config.mpAccessToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12_000),redirect:'error'});}
    catch {throw fail('Mercado Pago no respondió. Conservamos el pedido para verificarlo.',502);}
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data)throw fail(`No se pudo consultar Mercado Pago (HTTP ${response.status}).`,502);
    return data;
  }
  return {
    getSeller:()=>request('/users/me'),
    createPreference:body=>request('/checkout/preferences',{method:'POST',body}),
    getPreference:id=>request(`/checkout/preferences/${encodeURIComponent(id)}`),
    getPayment:id=>request(`/v1/payments/${encodeURIComponent(id)}`),
    getMerchantOrder:id=>request(`/merchant_orders/${encodeURIComponent(id)}`),
    searchPayments:(reference,offset=0)=>request(`/v1/payments/search?${new URLSearchParams({external_reference:reference,sort:'date_created',criteria:'desc',limit:'50',offset:String(offset)})}`)
  };
}
