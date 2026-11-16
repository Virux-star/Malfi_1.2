import transbank from 'transbank-sdk';
const { Options, WebpayPlus, Environment, IntegrationCommerceCodes, IntegrationApiKeys } = transbank;

export function runtimeConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const apiOrigin = (env.PUBLIC_API_URL || env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const mode = env.WEBPAY_MODE || 'disabled';
  if (!['disabled', 'integration', 'production'].includes(mode)) throw new Error('WEBPAY_MODE no válido.');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET requiere al menos 32 caracteres aleatorios.');
  for (const url of [origin, apiOrigin]) {
    const u = new URL(url);
    if (u.origin !== url || (production && u.protocol !== 'https:')) throw new Error('PUBLIC_URL y PUBLIC_API_URL deben ser orígenes válidos; HTTPS en producción.');
  }
  if (mode === 'production' && (!production || !env.WEBPAY_COMMERCE_CODE || !env.WEBPAY_API_KEY)) {
    throw new Error('Webpay producción requiere NODE_ENV=production y credenciales propias.');
  }
  if (production && [env.WEBPAY_TEST_MODE, env.MP_TEST_MODE].includes('true')) {
    throw new Error('Desactiva las pasarelas y correos heredados de prueba antes de publicar.');
  }
  const mpMode=env.MP_MODE || 'disabled';
  if (!['disabled','integration','production'].includes(mpMode)) throw new Error('MP_MODE no válido.');
  if (mpMode==='production' && !production) throw new Error('Mercado Pago producción requiere NODE_ENV=production.');
  const flowMode=env.FLOW_MODE || 'disabled';
  if (!['disabled','integration','production'].includes(flowMode)) throw new Error('FLOW_MODE no válido.');
  if (flowMode==='production' && !production) throw new Error('Flow producción requiere NODE_ENV=production.');
  if (env.ORDER_TOKEN_SECRET && env.ORDER_TOKEN_SECRET.length < 32) throw new Error('ORDER_TOKEN_SECRET requiere al menos 32 caracteres.');
  return { production, origin, apiOrigin, mode, mpMode, mpAccessToken:env.MP_ACCESS_TOKEN||'', mpWebhookSecret:env.MP_WEBHOOK_SECRET||'', mpCollectorId:env.MP_COLLECTOR_ID||'', mpPublicOrigin:(env.MP_PUBLIC_BASE_URL||apiOrigin).replace(/\/+$/, ''),
    flowMode,flowApiKey:(env.FLOW_API_KEY||'').trim(),flowSecretKey:(env.FLOW_SECRET_KEY||'').trim(),flowPublicOrigin:(env.FLOW_PUBLIC_BASE_URL||apiOrigin).replace(/\/+$/,''),enabled: env.CHECKOUT_ENABLED === 'true',
    allowIntegration: env.ALLOW_INTEGRATION_CHECKOUT === 'true', emailMode: env.EMAIL_MODE || 'disabled', secret: env.ORDER_TOKEN_SECRET || env.SESSION_SECRET };
}

export function createWebpayClient(config) {
  if (config.mode === 'disabled') return null;
  const live = config.mode === 'production';
  return new WebpayPlus.Transaction(new Options(
    live ? process.env.WEBPAY_COMMERCE_CODE : IntegrationCommerceCodes.WEBPAY_PLUS,
    live ? process.env.WEBPAY_API_KEY : IntegrationApiKeys.WEBPAY,
    live ? Environment.Production : Environment.Integration, 10_000
  ));
}
