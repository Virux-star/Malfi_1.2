// Guardar junto al package.json principal de MALFI.
// Ejecutar: node --env-file=Backend/.env diagnosticarMercadoPago.mjs --buyer=3846716128
// Solo SELECT en una transacción READ ONLY y consultas GET a Mercado Pago.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const knownStates = new Set(['pending','approved','authorized','in_process','in_mediation','rejected','cancelled','refunded','charged_back']);
const date = value => {
  const ms = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};
const yes = value => value ? 'Sí' : 'No';
function publicEndpoint(value) {
  try {
    const u = new URL(value);
    return { origin:u.origin, path:u.pathname, https:u.protocol==='https:', credentials:!!(u.username||u.password) };
  } catch { return null; }
}

export async function diagnose({ config, pool, client, buyerId, orderId, now = Date.now() }) {
  if (!client) throw new Error('Mercado Pago está desactivado o falta MP_ACCESS_TOKEN.');
  const lines = ['DIAGNÓSTICO MALFI / MERCADO PAGO', `Fecha del equipo (UTC): ${new Date(now).toISOString()}`];
  const seller = await client.getSeller();
  lines.push(`Modo: ${['integration','production','disabled'].includes(config.mpMode)?config.mpMode:'No reconocido'}`);
  lines.push(`Vendedor coincide con MP_COLLECTOR_ID: ${yes(String(seller.id)===config.mpCollectorId)}`);
  lines.push(`Vendedor de Chile: ${yes(seller.site_id==='MLC')}`);
  lines.push(`Vendedor de prueba: ${yes(Array.isArray(seller.tags)&&seller.tags.includes('test_user'))}`);
  if (buyerId) lines.push(`Comprador indicado es distinto del vendedor: ${yes(String(seller.id)!==buyerId)}`);
  const db = await pool.connect();
  let row;
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout = '5s'");
    const result = await db.query(`SELECT o.id, o.total_clp, o.expires_at, o.created_at,
      o.payment_mode, o.status, o.payment_status, c.state, c.preference_id, c.collector_id,
      c.external_reference, c.checkout_url, c.preference_expires_at
      FROM orders o LEFT JOIN mercadopago_checkouts c ON c.order_id=o.id
      WHERE o.payment_provider='mercadopago' AND ($1::bigint IS NULL OR o.id=$1::bigint)
      ORDER BY o.created_at DESC, o.id DESC LIMIT 1`, [orderId || null]);
    row = result.rows[0];
    await db.query('COMMIT');
  } catch {
    await db.query('ROLLBACK').catch(()=>{});
    throw new Error('No se pudo leer el pedido. Comprueba la conexión y que las migraciones estén aplicadas.');
  } finally { db.release(); }
  if (!row) return [...lines, 'No se encontró un pedido de Mercado Pago en esta base.', 'Fin: no se crearon cobros ni se modificaron datos.'];
  lines.push(`Pedido revisado: ${/^\d+$/.test(String(row.id))?row.id:'ID no válido'}`);
  lines.push(`Reserva del pedido vencida según el equipo: ${date(row.expires_at)===null?'No verificable':yes(date(row.expires_at)<=now)}`);
  lines.push(`Modo del pedido coincide: ${yes(row.payment_mode===config.mpMode)}`);
  if (!row.preference_id) return [...lines, 'El pedido no tiene una preferencia confirmada. No se intentó crear otra.', 'Fin: no se crearon cobros ni se modificaron datos.'];
  if (!/^[A-Za-z0-9_-]{5,180}$/.test(String(row.preference_id))) throw new Error('La preferencia guardada tiene un formato no válido.');
  const pref = await client.getPreference(String(row.preference_id));
  lines.push(`Preferencia: ${String(row.preference_id)}`);
  lines.push(`Preferencia corresponde al vendedor: ${yes(String(pref.collector_id)===String(seller.id))}`);
  lines.push(`Referencia coincide con el pedido: ${yes(pref.external_reference===row.external_reference)}`);
  lines.push(`Mercado Pago informa preference_expired: ${typeof pref.preference_expired==='boolean'?yes(pref.preference_expired):'No informado'}`);
  const from = date(pref.expiration_date_from), to = date(pref.expiration_date_to);
  lines.push(`Inicio de vigencia (UTC): ${from===null?'No informado':new Date(from).toISOString()}`);
  lines.push(`Fin de vigencia (UTC): ${to===null?'No informado':new Date(to).toISOString()}`);
  lines.push(`Dentro de la vigencia según el equipo: ${pref.expires===false?'Sin vencimiento':to===null?'No verificable':yes((from===null||from<=now)&&now<to)}`);
  const items = Array.isArray(pref.items) ? pref.items : [];
  const total = items.reduce((sum,i)=>sum+Number(i.unit_price)*Number(i.quantity),0);
  lines.push(`Ítems en pesos chilenos: ${yes(items.length>0&&items.every(i=>i.currency_id==='CLP'))}`);
  lines.push(`Total coincide con MALFI: ${yes(items.length>0&&Number.isSafeInteger(total)&&total===Number(row.total_clp))}`);
  lines.push(`Enlace guardado es el init_point de Mercado Pago: ${yes(!!pref.init_point&&row.checkout_url===pref.init_point)}`);
  lines.push(`Enlace guardado es sandbox_init_point: ${yes(!!pref.sandbox_init_point&&row.checkout_url===pref.sandbox_init_point)}`);
  const link = publicEndpoint(row.checkout_url);
  lines.push(`Dominio del enlace de pago: ${link&&!link.credentials?link.origin:'No válido'}`);
  const expected = publicEndpoint(config.mpPublicOrigin);
  for (const kind of ['success','pending','failure']) {
    const endpoint = publicEndpoint(pref.back_urls?.[kind]);
    lines.push(`Retorno ${kind} coincide con MP_PUBLIC_BASE_URL actual: ${yes(!!expected&&!!endpoint&&endpoint.https&&!endpoint.credentials&&endpoint.origin===expected.origin&&endpoint.path==='/api/payments/mercadopago/return')}`);
  }
  const notification = publicEndpoint(pref.notification_url);
  lines.push(`Webhook coincide con MP_PUBLIC_BASE_URL actual: ${yes(!!expected&&!!notification&&notification.https&&!notification.credentials&&notification.origin===expected.origin&&notification.path==='/api/payments/mercadopago/webhook')}`);
  try {
    const payments = await client.searchPayments(row.external_reference);
    if (!Array.isArray(payments.results)) throw new Error();
    const counts = {};
    for (const p of payments.results) {
      const state = knownStates.has(p.status) ? p.status : 'otro';
      counts[state] = (counts[state]||0)+1;
    }
    lines.push(`Pagos encontrados en la consulta: ${payments.results.length}`);
    for (const [state,count] of Object.entries(counts)) lines.push(`  ${state}: ${count}`);
    if (payments.results.length===0) lines.push('Una búsqueda vacía no confirma la ausencia de un cobro en curso.');
  } catch { lines.push('No se pudo consultar la lista de pagos. No se cambió el estado del pedido.'); }
  lines.push('Este diagnóstico no comprueba la sesión del navegador ni la habilitación interna del botón de Mercado Pago.');
  lines.push('Fin: no se crearon cobros ni se modificaron datos.');
  return lines;
}

async function main() {
  let pool;
  try {
    const args = process.argv.slice(2);
    if (args.some(arg=>!/^--(?:buyer|order)=[1-9]\d{0,19}$/.test(arg))) throw new Error('Usa --buyer=ID y opcionalmente --order=NUMERO.');
    const buyerId=args.find(a=>a.startsWith('--buyer='))?.slice(8);
    const orderId=args.find(a=>a.startsWith('--order='))?.slice(8);
    const [{runtimeConfig},{createPool},{createMercadoPagoClient}] = await Promise.all([
      import('./Backend/config/runtime.js'), import('./Backend/config/database.js'), import('./Backend/services/mercadoPagoClient.js')
    ]);
    const config=runtimeConfig();
    pool=createPool();
    const client=createMercadoPagoClient(config);
    // No se registra .env, respuestas completas de la API, clientes ni URLs privadas.
    console.log((await diagnose({config,pool,client,buyerId,orderId})).join('\n'));
  } catch (error) {
    // Errores de configuración conocidos no contienen valores privados.
    const allowed = /^(Usa --buyer=|Mercado Pago está|No se pudo leer el pedido|La preferencia guardada|No se pudo consultar Mercado Pago \(HTTP \d{3}\)|Mercado Pago no respondió\.|SESSION_SECRET requiere|ORDER_TOKEN_SECRET requiere|PUBLIC_URL y PUBLIC_API_URL deben|WEBPAY_MODE no válido|MP_MODE no válido|Webpay producción requiere|Mercado Pago producción requiere|Desactiva las pasarelas)/;
    console.error('Diagnóstico interrumpido:', allowed.test(error.message)?error.message:'No se pudo completar la consulta. Comprueba la ubicación del archivo, las dependencias y la conexión.');
    process.exitCode=1;
  } finally { if(pool) await pool.end(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) await main();
