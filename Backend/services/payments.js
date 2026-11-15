import { providerAvailable } from '../config/paymentProviders.js';
import { createHash, createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
export const digest = text => createHash('sha256').update(text).digest('hex');
export const orderToken = (key, config) => createHmac('sha256', config.secret).update(`malfi-order:${key}`).digest('hex');
export const validId = id => typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
export function fail(message, status=409) { return Object.assign(new Error(message), {status}); }
export function validBank(bank, attempt) {
  return bank && String(bank.buy_order) === attempt.buy_order && String(bank.session_id) === attempt.session_id &&
    Number.isSafeInteger(Number(bank.amount)) && Number(bank.amount) === Number(attempt.amount_clp);
}
export const bankApproved = (bank, attempt) => validBank(bank, attempt) && bank.status === 'AUTHORIZED' && bank.response_code === 0;
export function paymentUrlAllowed(url, mode) {
  try { const u=new URL(url); return u.protocol==='https:' && u.hostname === (mode==='production'?'webpay3g.transbank.cl':'webpay3gint.transbank.cl') && !u.username && !u.password && !u.port; }
  catch { return false; }
}
export async function customerOrder(pool, id, token) {
  if (!validId(id) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('Pedido no encontrado.',404);
  const result = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
  const o=result.rows[0];
  if (!o?.access_token_hash || !timingSafeEqual(Buffer.from(o.access_token_hash), Buffer.from(digest(token)))) throw fail('Pedido no encontrado.',404);
  return o;
}

export async function settlePayment(pool, attemptId, bank) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const found=await client.query('SELECT order_id FROM webpay_payments WHERE id=$1',[attemptId]);
    if (!found.rowCount) throw fail('Pago no encontrado.');
    // Consistent lock order: order, payment, products.
    const order=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[found.rows[0].order_id])).rows[0];
    const a=(await client.query('SELECT * FROM webpay_payments WHERE id=$1 FOR UPDATE',[attemptId])).rows[0];
    if (order.payment_provider!=='webpay') throw fail('El pedido corresponde a otra pasarela.');
    if (!bankApproved(bank,a)) throw fail('Webpay no confirma la autorización de este pedido.');
    if (Number(order.total_clp)!==Number(a.amount_clp)) throw fail('El monto del pedido cambió.');
    if (a.state==='paid' && order.payment_status==='paid') { await client.query('COMMIT'); return 'paid'; }
    if (order.payment_status==='paid') throw fail('Autorización duplicada: revisión manual necesaria.');
    const items=(await client.query('SELECT product_id, SUM(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id',[order.id])).rows;
    const products=(await client.query('SELECT id, stock, reserved_stock FROM products WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',[items.map(i=>i.product_id)])).rows;
    const productMap=new Map(products.map(p=>[p.id,p]));
    const fulfill=items.length>0 && order.status==='pending_payment' && order.payment_status==='pending' && order.inventory_reserved && !order.stock_deducted_at && items.every(i=>{
      const p=productMap.get(i.product_id);return p && p.stock>=i.quantity && p.reserved_stock>=i.quantity;
    });
    if (fulfill) for (const i of items) await client.query('UPDATE products SET stock=stock-$1,reserved_stock=reserved_stock-$1 WHERE id=$2',[i.quantity,i.product_id]);
    await client.query(`UPDATE orders SET payment_status='paid', status=$2,
      inventory_reserved=CASE WHEN $3 THEN FALSE ELSE inventory_reserved END,
      stock_deducted_at=CASE WHEN $3 THEN now() ELSE stock_deducted_at END,paid_at=COALESCE(paid_at,now()) WHERE id=$1`,[order.id,fulfill?'pending_payment':'payment_review',fulfill]);
    await client.query(`UPDATE webpay_payments SET state=$2,authorization_code=$3,payment_type_code=$4,card_last4=$5,
      bank_transaction_date=$6,response_code=0,bank_status='AUTHORIZED',updated_at=now(),finalized_at=now() WHERE id=$1`,[
      a.id,fulfill?'paid':'review',String(bank.authorization_code||'').slice(0,20),String(bank.payment_type_code||'').slice(0,10),
      /^\d{4}$/.test(String(bank.card_detail?.card_number))?String(bank.card_detail.card_number):null,
      bank.transaction_date && !Number.isNaN(Date.parse(bank.transaction_date))?bank.transaction_date:null
    ]);
    if (fulfill) await client.query(`INSERT INTO order_email_outbox(order_id,kind) VALUES($1,'payment_confirmed'),($1,'admin_new_order') ON CONFLICT(order_id,kind) DO NOTHING`,[order.id]);
    await client.query('COMMIT');
    return fulfill?'paid':'review';
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function reconcilePayment(pool, tx, config, payment) {
  if (!tx || payment.mode!==config.mode) throw fail('El ambiente del pago no coincide con la configuración actual.');
  if (!payment.token_ws) {
    await pool.query("UPDATE webpay_payments SET state='review',last_error='Creación sin respuesta definitiva. Revisar en Transbank.',updated_at=now() WHERE id=$1 AND state='starting'",[payment.id]);
    return 'review';
  }
  const bank=await tx.status(payment.token_ws);
  if (!validBank(bank,payment)) throw fail('Los datos de Webpay no coinciden.');
  if (bankApproved(bank,payment)) return settlePayment(pool,payment.id,bank);
  if (bank.status==='FAILED') {
    await pool.query("UPDATE webpay_payments SET state='failed',bank_status='FAILED',response_code=$2,updated_at=now() WHERE id=$1 AND state NOT IN ('paid') AND finalized_at IS NULL",[payment.id,Number.isInteger(bank.response_code)?bank.response_code:null]);
    return 'failed';
  }
  // INITIALIZED is never treated as proof that a charge failed.
  // Reversals of settled payments need operator review, not automatic inventory changes.
  await pool.query('UPDATE webpay_payments SET bank_status=$2,updated_at=now() WHERE id=$1',[payment.id,String(bank.status).slice(0,40)]);
  return 'review';
}

export async function startPayment(pool, tx, config, id) {
  if (!tx || !providerAvailable(config,'webpay')) throw fail('Los pagos no están disponibles en este momento.',503);
  const client=await pool.connect();
  let attempt;
  try {
    await client.query('BEGIN');
    const order=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!order || order.payment_status!=='pending' || order.status!=='pending_payment' || !order.inventory_reserved || new Date(order.expires_at)<new Date()) throw fail('La reserva ya no está disponible para pagar.');
    if (order.payment_provider!=='webpay') throw fail('Este pedido corresponde a otro medio de pago.');
    if (order.payment_mode!==config.mode) throw fail('Este pedido pertenece a otro ambiente de pago.');
    const legacy=await client.query('SELECT 1 FROM webpay_test_attempts WHERE order_id=$1 UNION ALL SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1',[id]);
    if ((await client.query('SELECT 1 FROM mercadopago_checkouts WHERE order_id=$1',[id])).rowCount) throw fail('El pedido tiene un checkout de Mercado Pago pendiente de revisión.');
    if (legacy.rowCount) throw fail('Este pedido tiene un pago anterior que requiere revisión.');
    const previous=(await client.query('SELECT * FROM webpay_payments WHERE order_id=$1 ORDER BY created_at DESC',[id])).rows;
    const active=previous.find(p=>p.state!=='failed');
    if (active) {
      if (active.state==='created' && active.checkout_url && Date.now()-new Date(active.created_at).getTime()<4*60_000) {
        await client.query('COMMIT');return {provider:'webpay',url:active.checkout_url,token:active.token_ws};
      }
      throw fail('Estamos verificando el intento anterior. No realices otro pago hasta conocer su resultado.');
    }
    if (previous.length>=5) throw fail('Se alcanzó el límite de intentos de este pedido. Contáctanos.');
    attempt={ id:randomUUID(), buy_order:`M${randomBytes(12).toString('hex')}`,session_id:randomUUID(),amount_clp:Number(order.total_clp) };
    await client.query(`INSERT INTO webpay_payments(id,order_id,buy_order,session_id,amount_clp,mode,state) VALUES($1,$2,$3,$4,$5,$6,'starting')`,[attempt.id,id,attempt.buy_order,attempt.session_id,attempt.amount_clp,config.mode]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  try {
    const result=await tx.create(attempt.buy_order,attempt.session_id,attempt.amount_clp,`${config.apiOrigin}/api/payments/webpay/return`);
    if (!paymentUrlAllowed(result.url,config.mode) || typeof result.token!=='string' || !/^[a-zA-Z0-9_-]{20,150}$/.test(result.token)) throw new Error('Respuesta de creación no válida.');
    await pool.query("UPDATE webpay_payments SET token_ws=$2,checkout_url=$3,state='created',updated_at=now() WHERE id=$1 AND state IN ('starting','review')",[attempt.id,result.token,result.url]);
    return {provider:'webpay',url:result.url,token:result.token};
  } catch(e) {
    await pool.query("UPDATE webpay_payments SET state='review',last_error='Creación de Webpay sin resultado confirmado.',updated_at=now() WHERE id=$1 AND state='starting'",[attempt.id]);
    throw fail('No pudimos confirmar el inicio del pago. Tu pedido se conserva para verificarlo; evita repetir la compra.',502);
  }
}

export async function releaseExpiredOrders(pool) {
  const candidates=(await pool.query(`SELECT id FROM orders o WHERE status='pending_payment' AND payment_status='pending' AND inventory_reserved=TRUE AND expires_at<now()
    AND NOT EXISTS(SELECT 1 FROM webpay_payments p WHERE p.order_id=o.id AND p.state<>'failed')
    AND NOT EXISTS(SELECT 1 FROM webpay_test_attempts w WHERE w.order_id=o.id)
    AND NOT EXISTS(SELECT 1 FROM mercado_pago_attempts m WHERE m.order_id=o.id)
    AND NOT EXISTS(SELECT 1 FROM mercadopago_checkouts m WHERE m.order_id=o.id) LIMIT 50`)).rows;
  for (const {id} of candidates) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const check=await client.query(`SELECT id FROM orders o WHERE id=$1 AND status='pending_payment' AND payment_status='pending' AND inventory_reserved=TRUE AND expires_at<now() FOR UPDATE`,[id]);
      const active=await client.query("SELECT 1 FROM webpay_payments WHERE order_id=$1 AND state<>'failed' UNION ALL SELECT 1 FROM webpay_test_attempts WHERE order_id=$1 UNION ALL SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1 UNION ALL SELECT 1 FROM mercadopago_checkouts WHERE order_id=$1",[id]);
      if (check.rowCount && !active.rowCount) {
        const items=(await client.query('SELECT product_id,SUM(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id',[id])).rows;
        if (!items.length) throw fail('Pedido sin productos.');
        for (const i of items) {
          const changed=await client.query('UPDATE products SET reserved_stock=reserved_stock-$1 WHERE id=$2 AND reserved_stock >= $1 RETURNING id',[i.quantity,i.product_id]);
          if (!changed.rowCount) throw fail('Reserva inconsistente.');
        }
        await client.query("UPDATE orders SET status='cancelled',inventory_reserved=FALSE WHERE id=$1",[id]);
      }
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); console.error('Revisión de reserva:',id,e.message); }
    finally { client.release(); }
  }
}
