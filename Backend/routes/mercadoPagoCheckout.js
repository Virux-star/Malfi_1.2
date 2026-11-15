import { WebhookSignatureValidator } from 'mercadopago';
import { digest, orderToken } from '../services/payments.js';
import { mpId, processMpPayment, reconcileMpCheckout } from '../services/mercadoPago.js';

export function registerMercadoPagoCheckout(app,pool,config,client) {
  app.post('/api/payments/mercadopago/webhook',async(req,res)=>{
    if(!client||!config.mpWebhookSecret)return res.sendStatus(503);
    const id=req.query['data.id'];
    if(!mpId(id)||typeof req.get('x-request-id')!=='string'||req.get('x-request-id').length>200||typeof req.get('x-signature')!=='string'||req.get('x-signature').length>500)return res.sendStatus(400);
    try {WebhookSignatureValidator.validate({xSignature:req.get('x-signature'),xRequestId:req.get('x-request-id'),dataId:id,secret:config.mpWebhookSecret});}
    catch {return res.sendStatus(401);}
    if(req.query.type!=='payment')return res.sendStatus(200);
    if((req.body?.type&&req.body.type!=='payment')||(req.body?.data?.id!==undefined&&String(req.body.data.id)!==id))return res.sendStatus(400);
    try {await processMpPayment(pool,client,config,id);return res.sendStatus(200);}
    catch(e) {console.error('Notificación Mercado Pago pendiente de revisar:',id,e.message);return res.sendStatus(500);}
  });

  // The opaque state is required before returning access to any private order.
  // Status, payment_id and external_reference in the browser URL are untrusted.
  app.get('/api/payments/mercadopago/return',async(req,res,next)=>{
    const state=req.query.state;
    if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state))return res.redirect(303,`${config.origin}/pedido`);
    try {
      const a=(await pool.query('SELECT * FROM mercadopago_checkouts WHERE return_state_hash=$1',[digest(state)])).rows[0];
      if(!a)return res.redirect(303,`${config.origin}/pedido`);
      if(client && a.mode===config.mpMode && a.collector_id===config.mpCollectorId) {
        try {
          if(mpId(req.query.payment_id)) {
            // A matching signed state alone does not bind an arbitrary payment ID.
            const p=await client.getPayment(req.query.payment_id);
            if(p.external_reference===a.external_reference)await processMpPayment(pool,client,config,req.query.payment_id);
            else console.error('Retorno Mercado Pago con referencia distinta:',a.id);
          } else await reconcileMpCheckout(pool,client,config,a);
        }catch(e){console.error('Retorno Mercado Pago pendiente:',a.id,e.message);}
      }
      const o=(await pool.query('SELECT checkout_key FROM orders WHERE id=$1',[a.order_id])).rows[0];
      if(!o?.checkout_key)return res.redirect(303,`${config.origin}/pedido`);
      return res.redirect(303,`${config.origin}/pedido/${a.order_id}#token=${orderToken(o.checkout_key,config)}`);
    }catch(e){next(e);}
  });
}
