import { orderItemDescription } from './productOptions.js';
import { orderToken } from './payments.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const clp = value => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0
}).format(Number(value));

export function compactOrderEmail(kind, order, items, config, confirmationText) {
  if (!['payment_confirmed', 'admin_new_order'].includes(kind)) {
    throw new Error('Tipo de correo no admitido.');
  }
  const admin = kind === 'admin_new_order';
  const pickup = order.delivery_method === 'pickup';
  if (!admin && !confirmationText) throw new Error('Falta el comprobante de la compra.');
  const business = order.business_snapshot || {};
  const test = order.payment_mode !== 'production';
  const title = admin ? 'Nuevo pedido pagado' : 'Tu compra está confirmada';
  const intro = admin
    ? 'Tienes un nuevo pedido para preparar.'
    : `Gracias por tu compra, ${order.customer_name}. Recibimos tu pago.`;
  const url = admin ? `${config.origin}/admin/pedidos`
    : `${config.origin}/pedido/${order.id}#token=${orderToken(order.checkout_key, config)}`;
  const action = admin ? 'Administrar pedidos' : 'Consultar mi pedido';
  const delivery = `${order.shipping_address}, ${order.shipping_comuna}, ${order.shipping_region}`;
  const period = pickup
    ? `Preparación estimada: hasta ${order.delivery_days_max} día(s) hábil(es) desde el pago. Revisa el estado en tu pedido y coordina el retiro con MALFI antes de ir`
    : `${order.delivery_days_min} a ${order.delivery_days_max} días hábiles desde el pago`;
  const deliveryLabel = pickup ? 'Retiro en tienda' : 'Entrega';
  const costLabel = pickup ? 'Retiro en tienda' : `Despacho (${order.carrier})`;
  const costValue = pickup ? 'Sin costo' : Number(order.shipping_clp) === 0 ? 'Gratis' : clp(order.shipping_clp);
  const contact = [business.email, business.phone].filter(Boolean).join(' · ');
  const note = admin ? '' : 'Adjuntamos el comprobante con las condiciones y los datos legales de tu compra.';
  const text = [
    `MALFI${test ? ' · PRUEBA SIN COBRO REAL' : ''}`, title, intro, `Pedido #${order.id}`,
    admin && `Cliente: ${order.customer_name}`,
    admin && `Contacto del cliente: ${order.customer_email} · ${order.customer_phone}`,
    ...items.map(item => `${orderItemDescription(item)} · ${item.quantity} × ${clp(item.unit_price_clp)} = ${clp(item.line_total_clp)}`),
    `Subtotal: ${clp(order.subtotal_clp)}`, `${costLabel}: ${costValue}`,
    `Total pagado: ${clp(order.total_clp)}`, `${deliveryLabel}: ${delivery}`, pickup ? period : `Plazo estimado: ${period}`,
    `${action}: ${url}`, note, contact && `¿Necesitas ayuda? ${contact}`
  ].filter(Boolean).join('\n');
  const rows = items.map(item => `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #e9dfd1;overflow-wrap:anywhere">${escape(orderItemDescription(item))}<br>
      <span style="font-size:13px;color:#75675d">${escape(item.quantity)} × ${escape(clp(item.unit_price_clp))}</span></td>
    <td style="padding:12px 0;border-bottom:1px solid #e9dfd1;text-align:right;white-space:nowrap;vertical-align:top">${escape(clp(item.line_total_clp))}</td>
  </tr>`).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#faf8f5;color:#49382e;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 12px" align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border:1px solid #e9dfd1"><tr><td style="padding:28px 24px">
    <p style="font-family:Georgia,serif;font-size:30px;letter-spacing:4px;margin:0 0 20px">MALFI</p>
    ${test ? '<p style="font-size:12px;color:#75675d">PRUEBA SIN COBRO REAL</p>' : ''}
    <h1 style="font-family:Georgia,serif;font-size:25px;font-weight:normal;line-height:1.3;margin:0 0 12px">${escape(title)}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px">${escape(intro)}</p>
    <p style="font-size:14px;margin:0 0 8px"><strong>Pedido #${escape(order.id)}</strong></p>
    ${admin ? `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Cliente: ${escape(order.customer_name)}<br>${escape(order.customer_email)} · ${escape(order.customer_phone)}</p>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5">${rows}
      <tr><td style="padding-top:14px">Subtotal</td><td style="padding-top:14px;text-align:right">${escape(clp(order.subtotal_clp))}</td></tr>
      <tr><td style="padding:8px 0 14px">${escape(costLabel)}</td><td style="padding:8px 0 14px;text-align:right">${escape(costValue)}</td></tr>
      <tr><td style="padding-top:14px;border-top:1px solid #e9dfd1"><strong>Total pagado</strong></td><td style="padding-top:14px;border-top:1px solid #e9dfd1;text-align:right;white-space:nowrap"><strong>${escape(clp(order.total_clp))}</strong></td></tr>
    </table>
    <p style="font-size:14px;line-height:1.7;margin:22px 0"><strong>${escape(deliveryLabel)}</strong><br>${escape(delivery)}<br>${escape(period)}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#49382e" style="padding:13px 20px"><a href="${escape(url)}" style="color:#fff;text-decoration:none;font-size:14px">${escape(action)}</a></td></tr></table>
    ${note ? `<p style="font-size:12px;line-height:1.6;color:#75675d;margin:20px 0 0">${escape(note)}</p>` : ''}
    ${contact ? `<p style="font-size:12px;line-height:1.6;color:#75675d;margin:12px 0 0">¿Necesitas ayuda? ${escape(contact)}</p>` : ''}
  </td></tr></table></td></tr></table></body></html>`;
  const email = { subject: `MALFI · ${title} #${order.id}${test ? ' [PRUEBA]' : ''}`, text, html };
  if (!admin) {
    const fullText = confirmationText + (business.representative ? `\nRepresentante legal: ${business.representative}` : '');
    email.attachments = [{
      filename: `MALFI-pedido-${order.id}-comprobante.txt`,
      content: Buffer.from(fullText, 'utf8').toString('base64'),
      contentType: 'text/plain; charset=utf-8'
    }];
  }
  return email;
}
