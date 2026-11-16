import { paymentProviders } from '../config/paymentProviders.js';
import { pickupLocation } from '../config/fulfillment.js';
export const defaultStore = {
  legalName: '', rut: '', legalAddress: '', representative: '', email: '', phone: '',
  instagram: 'https://www.instagram.com/malfi.candles/', origin: 'Las Condes, Región Metropolitana, Chile',
  preparationDays: 3, returnsInstructions: 'Escríbenos indicando el número de pedido para coordinar cambios, retracto o garantía.',
  policiesVersion: '2026-11-15'
};
export async function getStore(pool) {
  const result = await pool.query("SELECT value FROM store_settings WHERE key='business'");
  return { ...defaultStore, ...(result.rows[0]?.value || {}) };
}
export async function readiness(pool, config) {
  const store = await getStore(pool);
  const issues = [];
  if (!config.enabled) issues.push('Activa CHECKOUT_ENABLED después de completar la configuración.');
  const options=paymentProviders(config);
  if (!options.providers.length) issues.push('Configura al menos un medio de pago disponible: Webpay o Mercado Pago.');
  for (const field of ['legalName','rut','legalAddress','email','phone']) {
    if (!store[field]) issues.push(`Completa el dato del negocio: ${field}.`);
  }
  if (config.production && options.providers.some(p=>p.mode==='production') && (config.emailMode !== 'production' || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.ADMIN_EMAIL)) {
    issues.push('Configura los correos de producción: Resend, EMAIL_FROM y ADMIN_EMAIL.');
  }
  if (config.production && options.providers.some(p=>p.mode==='integration') && (!config.allowIntegration || config.emailMode!=='test' || !process.env.RESEND_API_KEY || !process.env.EMAIL_TEST_TO)) issues.push('Para validar en staging configura ALLOW_INTEGRATION_CHECKOUT=true y el correo de prueba.');
  const rates = await pool.query('SELECT COUNT(*)::int AS n FROM shipping_rates_comunas WHERE active=TRUE AND price_clp IS NOT NULL AND verified_at IS NOT NULL');
  if (!pickupLocation.enabled && !rates.rows[0].n) issues.push('Configura al menos una tarifa real de despacho y su plazo.');
  const products = await pool.query('SELECT COUNT(*)::int AS n FROM products WHERE active=TRUE AND stock-reserved_stock > 0');
  if (!products.rows[0].n) issues.push('Publica al menos un producto con stock disponible.');
  return { ready: issues.length === 0, issues, mode: config.mode, store, paymentProviders:options.providers, providerIssues:options.issues };
}
