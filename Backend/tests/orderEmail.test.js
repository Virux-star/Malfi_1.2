import test from 'node:test';
import assert from 'node:assert/strict';
import { compactOrderEmail } from '../services/compactOrderEmail.js';
import { orderEmail } from '../services/commerceWorker.js';

const config = { origin: 'https://malfi.example.test', secret: 'test-secret-for-private-order-links' };
const order = {
  id: 42, checkout_key: 'email-test-checkout', payment_mode: 'integration',
  customer_name: 'Cliente de prueba', customer_email: 'customer@example.test', customer_phone: '+56912345678',
  subtotal_clp: 20000, shipping_clp: 3500, total_clp: 23500, carrier: 'Paket',
  shipping_address: 'Dirección de entrega QA 123', shipping_comuna: 'Las Condes', shipping_region: 'Metropolitana de Santiago',
  delivery_days_min: 3, delivery_days_max: 5, terms_version: 'conditions-snapshot-v1',
  business_snapshot: {
    legalName: 'Negocio de pruebas', rut: '76.123.456-0', legalAddress: 'DOMICILIO LEGAL PRIVADO QA',
    representative: 'Representante de prueba', email: 'store@example.test', phone: '+56911111111',
    returnsInstructions: 'Contactar a la tienda indicando el número de pedido.'
  }
};
const items = [{ product_name: 'Vela de soja', quantity: 2, unit_price_clp: 10000, line_total_clp: 20000 }];

test('cliente recibe un resumen corto y los datos legales completos en el adjunto', () => {
  const original = orderEmail('payment_confirmed', order, items, config);
  const email = compactOrderEmail('payment_confirmed', order, items, config, original.text);
  for (const body of [email.text, email.html]) {
    assert.ok(!body.includes(order.business_snapshot.legalAddress));
    assert.ok(!body.includes('Condiciones aceptadas'));
    assert.ok(body.includes(order.shipping_address));
    assert.ok(body.includes('Vela de soja'));
    assert.ok(body.includes('/pedido/42#token='));
  }
  assert.ok(email.text.length < original.text.length / 2);
  assert.equal(email.attachments.length, 1);
  assert.equal(email.attachments[0].filename, 'MALFI-pedido-42-comprobante.txt');
  const attachment = Buffer.from(email.attachments[0].content, 'base64').toString('utf8');
  assert.ok(attachment.startsWith(original.text));
  assert.ok(attachment.includes(order.business_snapshot.legalAddress));
  assert.ok(attachment.includes(order.terms_version));
  assert.ok(attachment.includes(order.business_snapshot.returnsInstructions));
  assert.ok(attachment.includes(order.business_snapshot.representative));
  assert.match(email.subject, /\[PRUEBA\]/);
});

test('aviso interno conserva datos para preparar el pedido sin copiar las condiciones legales', () => {
  const email = compactOrderEmail('admin_new_order', { ...order, payment_mode: 'production' }, items, config);
  assert.equal(email.attachments, undefined);
  assert.ok(email.text.includes(order.customer_email));
  assert.ok(email.text.includes(order.customer_phone));
  assert.ok(email.text.includes(order.shipping_address));
  assert.ok(email.html.includes('/admin/pedidos'));
  assert.ok(!email.html.includes('#token='));
  assert.ok(!email.text.includes(order.business_snapshot.legalAddress));
  assert.doesNotMatch(email.subject, /PRUEBA/);
});

test('el resumen escapa texto del cliente y de los productos antes de insertarlo en HTML', () => {
  const hostile = { ...order, customer_name: '<img src=x onerror=alert(1)>' };
  const email = compactOrderEmail('payment_confirmed', hostile, [{ ...items[0], product_name: '<script>alert(2)</script>' }], config, 'Comprobante de prueba');
  assert.ok(!email.html.includes('<img'));
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('&lt;img'));
  assert.ok(email.html.includes('&lt;script&gt;'));
});

test('no se envía un resumen al cliente sin una copia completa de la confirmación', () => {
  assert.throws(() => compactOrderEmail('payment_confirmed', order, items, config), /comprobante/);
  assert.throws(() => compactOrderEmail('unknown', order, items, config), /Tipo de correo/);
});
