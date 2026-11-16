import { isIP } from 'node:net';
export function publicHttpsOrigin(value) {
  try {
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    return url.protocol==='https:' && url.origin===value && !url.username && !url.password &&
      !isIP(host.replace(/^\[|\]$/g,'')) && !['localhost','localhost.localdomain'].includes(host) && !host.endsWith('.localhost') && !host.endsWith('.local') && host.includes('.');
  } catch {return false;}
}
export function providerMode(config,provider='webpay') {
  return provider==='flow'?(config.flowMode||'disabled'):provider==='mercadopago'?(config.mpMode||'disabled'):config.mode;
}
export function paymentProviders(config) {
  const providers=[],issues=[];
  if (config.mode!=='disabled') {
    if(config.production&&config.mode!=='production'&&!config.allowIntegration)issues.push('Webpay: activa producción o autoriza expresamente el ambiente de integración de staging.');
    else providers.push({id:'webpay',label:'Webpay',mode:config.mode});
  }
  if (config.mpMode && config.mpMode!=='disabled') {
    const missing=[];
    if(!config.mpAccessToken)missing.push('MP_ACCESS_TOKEN');
    if(!config.mpWebhookSecret)missing.push('MP_WEBHOOK_SECRET');
    if(!/^[1-9]\d{0,19}$/.test(config.mpCollectorId||''))missing.push('MP_COLLECTOR_ID (ID del vendedor de ese ambiente)');
    if(!publicHttpsOrigin(config.mpPublicOrigin||''))missing.push('MP_PUBLIC_BASE_URL (origen HTTPS público)');
    if(config.production&&config.mpMode!=='production'&&!config.allowIntegration)missing.push('modo productivo o ALLOW_INTEGRATION_CHECKOUT para staging');
    if(missing.length)issues.push(`Mercado Pago: completa ${missing.join(', ')}.`);
    else providers.push({id:'mercadopago',label:'Mercado Pago',mode:config.mpMode});
  }
  if (config.flowMode && config.flowMode!=='disabled') {
    const missing=[];
    if(!config.flowApiKey)missing.push('FLOW_API_KEY');
    if(!config.flowSecretKey)missing.push('FLOW_SECRET_KEY');
    if(!publicHttpsOrigin(config.flowPublicOrigin||''))missing.push('FLOW_PUBLIC_BASE_URL (origen HTTPS público)');
    if(config.production&&config.flowMode==='integration'&&(!config.allowIntegration||config.emailMode!=='test'||providers.some(p=>p.mode==='production')))
      missing.push('una instalación separada de pruebas con ALLOW_INTEGRATION_CHECKOUT=true y EMAIL_MODE=test, sin pasarelas productivas');
    if(missing.length)issues.push(`Flow: completa ${missing.join(', ')}.`);
    else providers.push({id:'flow',label:'Flow',mode:config.flowMode});
  }
  return {providers,issues};
}
export const providerAvailable=(config,id)=>paymentProviders(config).providers.some(p=>p.id===id);
