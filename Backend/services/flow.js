import { createHmac, randomUUID } from 'node:crypto';
import { providerAvailable } from '../config/paymentProviders.js';
import { digest, fail, validId } from './payments.js';

export const flowReturnState = (id, config) => createHmac('sha256', config.secret).update(`malfi-flow-return:${id}`).digest('hex');
export const flowCredentialId = config => digest(config.flowApiKey || '');
export const validFlowToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(token);
export function flowOrderId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const id = String(value ?? '');
  return validId(id) ? id : null;
}
export function flowUrlAllowed(value, mode) {
  try {
    const u = new URL(value);
    const hosts = mode === 'production' ? ['www.flow.cl','flow.cl','api.flow.cl'] : mode === 'integration' ? ['sandbox.flow.cl'] : [];
    return u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port && !u.hash;
  } catch { return false; }
}
const sameAccount = (a, config) => a.mode === config.flowMode && a.credential_id === flowCredentialId(config);
function validateStatus(p, a) {
  const text = String(p?.amount ?? '');
  const amount = /^\d+(?:\.0+)?$/.test(text) ? Number(text) : NaN;
  if (!p || !flowOrderId(p.flowOrder) || (a.flow_order && String(p.flowOrder) !== String(a.flow_order)) ||
      p.commerceOrder !== a.commerce_order || p.currency !== 'CLP' || !Number.isSafeInteger(amount) ||
      amount !== Number(a.amount_clp) || ![1,2,3,4].includes(p.status))
    throw fail('La orden, moneda o monto confirmado por Flow no coincide con este pedido.');
}

export async function startFlow(pool, client, config, id) {
  if (!client || !providerAvailable(config, 'flow')) throw fail('Flow no está disponible en este momento.', 503);
  const db = await pool.connect();
  let a, order;
  try {
    await db.query('BEGIN');
    order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!order || order.payment_provider !== 'flow' || order.payment_mode !== config.flowMode)
      throw fail('Este pedido corresponde a otro medio o ambiente de pago.');
    if (order.status !== 'pending_payment' || order.payment_status !== 'pending' || !order.inventory_reserved || new Date(order.expires_at) <= new Date())
      throw fail('La reserva ya no está disponible para pagar.');
    const other = await db.query(`SELECT 1 FROM webpay_payments WHERE order_id=$1
      UNION ALL SELECT 1 FROM mercadopago_checkouts WHERE order_id=$1
      UNION ALL SELECT 1 FROM webpay_test_attempts WHERE order_id=$1
      UNION ALL SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1`, [id]);
    if (other.rowCount) throw fail('Este pedido tiene un intento de otra integración que requiere revisión.');
    const current = (await db.query('SELECT * FROM flow_checkouts WHERE order_id=$1', [id])).rows[0];
    if (current) {
      if (sameAccount(current, config) && current.state === 'created' && current.token && current.checkout_url && new Date(current.expires_at) > new Date()) {
        await db.query('COMMIT');
        return { provider: 'flow', mode: current.mode, url: current.checkout_url };
      }
      throw fail('Estamos verificando el intento anterior de Flow. Consulta tu pedido antes de volver a pagar.');
    }
    a = { id: randomUUID(), order_id: String(id), mode: config.flowMode,
      credential_id: flowCredentialId(config), amount_clp: Number(order.total_clp) };
    a.commerce_order = `malfi_${id}_${a.id}`;
    await db.query(`INSERT INTO flow_checkouts(id,order_id,mode,credential_id,commerce_order,amount_clp,return_state_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [a.id,id,a.mode,a.credential_id,a.commerce_order,a.amount_clp,digest(flowReturnState(a.id,config)),order.expires_at]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  try {
    const state = flowReturnState(a.id, config);
    const result = await client.createPayment({
      commerceOrder: a.commerce_order, subject: `MALFI · Pedido #${id}`, currency: 'CLP', amount: a.amount_clp,
      email: order.customer_email, paymentMethod: 9,
      urlConfirmation: `${config.flowPublicOrigin}/api/payments/flow/confirmation?state=${state}`,
      urlReturn: `${config.flowPublicOrigin}/api/payments/flow/return?state=${state}`,
      timeout: Math.max(1, Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000))
    });
    if (!validFlowToken(result.token) || !flowOrderId(result.flowOrder) || !flowUrlAllowed(result.url,a.mode))
      throw Object.assign(fail('Respuesta de creación Flow no válida.'), {flowDiagnostic:'CREATE_RESPONSE_INVALID'});
    const url = new URL(result.url); url.searchParams.set('token', result.token);
    const saved = await pool.query(`UPDATE flow_checkouts SET token=$2,flow_order=$3,checkout_url=$4,
      state=CASE WHEN state='starting' OR (state='review' AND last_error='Creación sin resultado confirmado.') THEN 'created' ELSE state END,
      updated_at=now() WHERE id=$1 AND (token IS NULL OR token=$2) AND (flow_order IS NULL OR flow_order=$3) RETURNING id`,
      [a.id,result.token,String(result.flowOrder),url.toString()]);
    if (!saved.rowCount) throw fail('La respuesta de Flow no coincide con el intento guardado.');
    return { provider: 'flow', mode: a.mode, url: url.toString() };
  } catch (error) {
    const diagnostic=/^(?:NETWORK|CREATE_RESPONSE_INVALID|HTTP_\d{1,3}(?:_CODE_-?\d{1,8})?(?:_FIELD_(?:COMMERCEORDER|SUBJECT|CURRENCY|AMOUNT|EMAIL|PAYMENTMETHOD|URLCONFIRMATION|URLRETURN|TIMEOUT|APIKEY|SECRETKEY|SIGNATURE|MERCHANT|ACCOUNT))?)$/.test(error?.flowDiagnostic||'')?error.flowDiagnostic:'UNCONFIRMED';
    console.error('Inicio Flow pendiente:',a.id,diagnostic);
    await pool.query(`UPDATE flow_checkouts SET state='review',last_error='Creación sin resultado confirmado.',updated_at=now()
      WHERE id=$1 AND state='starting'`, [a.id]);
    const hint=a.mode==='integration'&&typeof error?.flowSandboxHint==='string'?error.flowSandboxHint:'';
    throw fail('No pudimos confirmar el inicio de Flow. Conservamos el pedido para revisarlo; evita repetir la compra.'+(a.mode==='integration'?` Diagnóstico Sandbox: ${diagnostic}.${hint?' '+hint:''}`:''), 502);
  }
}

// Every callback and reconciliation reads Flow with signed server credentials.
// Neither browser status fields nor an elapsed timeout prove payment or failure.
export async function reconcileFlowCheckout(pool, client, config, a, token) {
  if (!client || !sameAccount(a,config)) throw fail('El ambiente o la cuenta de Flow cambió. Revisa la configuración.');
  if (token !== undefined && (!validFlowToken(token) || (a.token && a.token !== token))) throw fail('El token no corresponde a este intento de Flow.', 400);
  const canonicalToken = token || a.token;
  const p = canonicalToken ? await client.getStatus(canonicalToken) : await client.getStatusByCommerceId(a.commerce_order);
  validateStatus(p,a);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [a.order_id])).rows[0];
    const current = (await db.query('SELECT * FROM flow_checkouts WHERE id=$1 FOR UPDATE', [a.id])).rows[0];
    if (!order || !current || !sameAccount(current,config) || order.payment_provider !== 'flow' || order.payment_mode !== current.mode ||
        Number(order.total_clp) !== Number(current.amount_clp) || current.commerce_order !== a.commerce_order ||
        (canonicalToken && current.token && canonicalToken !== current.token)) throw fail('El pedido cambió durante la confirmación de Flow.');
    validateStatus(p,current);
    await db.query(`UPDATE flow_checkouts SET token=COALESCE(token,$2),flow_order=$3,last_reconciled_at=now(),updated_at=now() WHERE id=$1`, [a.id,canonicalToken||null,String(p.flowOrder)]);
    // Flow provides no event sequence number: a delayed pending/rejected observation must not undo a settled payment.
    if (['paid','refunded'].includes(order.payment_status) && current.provider_status === 2) {
      if(order.payment_status==='refunded') await db.query("UPDATE flow_checkouts SET state='review',last_error='Pedido con reembolso registrado: revisar el movimiento en Flow.' WHERE id=$1",[a.id]);
      await db.query('COMMIT'); return order.payment_status==='refunded'||current.state === 'review' ? 'review' : 'paid';
    }
    let outcome = 'pending';
    if (p.status === 2) {
      const items = (await db.query('SELECT product_id,SUM(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id', [order.id])).rows;
      const products = (await db.query('SELECT id,stock,reserved_stock FROM products WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [items.map(i=>i.product_id)])).rows;
      const byId = new Map(products.map(p=>[p.id,p]));
      const fulfill = order.status === 'pending_payment' && order.payment_status === 'pending' && order.inventory_reserved && !order.stock_deducted_at && items.length > 0 && items.every(i=>{
        const product = byId.get(i.product_id); return product && product.stock >= i.quantity && product.reserved_stock >= i.quantity;
      });
      if (fulfill) for (const i of items) await db.query('UPDATE products SET stock=stock-$1,reserved_stock=reserved_stock-$1 WHERE id=$2', [i.quantity,i.product_id]);
      await db.query(`UPDATE orders SET payment_status='paid',status=$2,paid_at=COALESCE(paid_at,now()),
        inventory_reserved=CASE WHEN $3 THEN FALSE ELSE inventory_reserved END,stock_deducted_at=CASE WHEN $3 THEN now() ELSE stock_deducted_at END WHERE id=$1`,
        [order.id,fulfill?'pending_payment':'payment_review',fulfill]);
      outcome = fulfill ? 'paid' : 'review';
      await db.query(`UPDATE flow_checkouts SET state=$2,provider_status=2,payment_method=$3,confirmed_at=COALESCE(confirmed_at,now()),last_error=$4 WHERE id=$1`,
        [a.id,outcome,String(p.paymentData?.media||'').slice(0,80)||null,fulfill?null:'Pago recibido: revisar inventario antes de preparar.']);
      if (fulfill) await db.query(`INSERT INTO order_email_outbox(order_id,kind,template_version) VALUES($1,'payment_confirmed',2),($1,'admin_new_order',2) ON CONFLICT(order_id,kind) DO NOTHING`, [order.id]);
    } else if (current.state === 'failed') outcome = 'failed';
    else if ([3,4].includes(p.status)) {
      // A signed API response confirms a terminal rejection/cancellation. Release this reservation once.
      if (order.status === 'pending_payment' && order.payment_status === 'pending' && order.inventory_reserved && !order.stock_deducted_at) {
        const items = (await db.query('SELECT product_id,SUM(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id', [order.id])).rows;
        for (const i of items) {
          const changed = await db.query('UPDATE products SET reserved_stock=reserved_stock-$1 WHERE id=$2 AND reserved_stock >= $1 RETURNING id', [i.quantity,i.product_id]);
          if (!changed.rowCount) throw fail('Reserva inconsistente: requiere revisión.');
        }
        await db.query("UPDATE orders SET status='cancelled',inventory_reserved=FALSE WHERE id=$1", [order.id]);
      }
      await db.query("UPDATE flow_checkouts SET state='failed',provider_status=$2,last_error=NULL WHERE id=$1", [a.id,p.status]);
      outcome = 'failed';
    } else {
      outcome = canonicalToken ? 'pending' : 'review';
      await db.query(`UPDATE flow_checkouts SET state=$2,provider_status=1,last_error=$3 WHERE id=$1`,
        [a.id,outcome,canonicalToken?null:'Creación pendiente recuperada por referencia: revisar en Flow antes de intentar otro pago.']);
    }
    await db.query('COMMIT'); return outcome;
  } catch(e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
