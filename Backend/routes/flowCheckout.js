import { rateLimit } from 'express-rate-limit';
import { digest, orderToken } from '../services/payments.js';
import { validFlowToken, reconcileFlowCheckout } from '../services/flow.js';

export function registerFlowCheckout(app, pool, config, client) {
  const limit = rateLimit({ windowMs: 15*60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false });
  async function find(req) {
    const state = req.query.state;
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || !validFlowToken(req.body?.token)) return null;
    const a = (await pool.query('SELECT * FROM flow_checkouts WHERE return_state_hash=$1', [digest(state)])).rows[0];
    return a && (!a.token || a.token === req.body.token) ? a : null;
  }
  app.post('/api/payments/flow/confirmation', limit, async (req,res,next) => {
    if (!client) return res.sendStatus(503);
    try {
      const a = await find(req);
      if (!a) return res.sendStatus(400);
      try { await reconcileFlowCheckout(pool,client,config,a,req.body.token); return res.sendStatus(200); }
      catch { console.error('Confirmación Flow pendiente de revisar:',a.id); return res.sendStatus(500); }
    } catch(e) { next(e); }
  });
  app.post('/api/payments/flow/return', limit, async (req,res,next) => {
    try {
      const a = await find(req);
      if (!a || !client) return res.redirect(303,`${config.origin}/pedido`);
      try { await reconcileFlowCheckout(pool,client,config,a,req.body.token); }
      catch {
        // A saved matching token + opaque return state can restore access during an API outage.
        if (!a.token) return res.redirect(303,`${config.origin}/pedido`);
        console.error('Retorno Flow pendiente de revisar:',a.id);
      }
      const order = (await pool.query('SELECT checkout_key FROM orders WHERE id=$1', [a.order_id])).rows[0];
      if (!order?.checkout_key) return res.redirect(303,`${config.origin}/pedido`);
      return res.redirect(303,`${config.origin}/pedido/${a.order_id}#token=${orderToken(order.checkout_key,config)}`);
    } catch(e) { next(e); }
  });
}
