import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { sendEmailsOnce } from '../services/commerceWorker.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('despacho gratis desde $50.000: precios, cobertura, Mercado Pago y correos', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /(?:test|qa)/i);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let server, paymentId = 700000;
  process.env.SESSION_SECRET = 'free-shipping-qa-session-000000000000000000';
  const config = {
    production: false, origin: 'http://localhost:5173', apiOrigin: 'http://localhost:3000',
    mode: 'disabled', enabled: true, emailMode: 'disabled', secret: process.env.SESSION_SECRET,
    mpMode: 'integration', mpAccessToken: 'PRIVATE-TEST-TOKEN', mpWebhookSecret: 'qa-free-shipping-webhook-secret',
    mpCollectorId: '123456', mpPublicOrigin: 'https://malfi-qa.example.test'
  };
  const preferences = new Map(), payments = new Map(), merchants = new Map();
  const mp = {
    getSeller: async () => ({ id: 123456, site_id: 'MLC', tags: ['test_user'] }),
    createPreference: async body => {
      const id = `pref_free_${randomUUID()}`;
      const pref = { ...structuredClone(body), id, collector_id: 123456,
        init_point: `https://www.mercadopago.cl/checkout/v1/redirect?pref_id=${id}` };
      preferences.set(id, pref);
      return structuredClone(pref);
    },
    getPreference: async id => structuredClone(preferences.get(id)),
    getPayment: async id => structuredClone(payments.get(String(id))),
    getMerchantOrder: async id => structuredClone(merchants.get(String(id)))
  };
  try {
    await migrate(pool);
    await pool.query('TRUNCATE order_email_outbox,mercadopago_payments,mercadopago_checkouts,webpay_payments,order_items,webpay_test_attempts,mercado_pago_attempts,orders,products,shipping_rates_comunas,store_settings,admin_sessions,admin_users RESTART IDENTITY CASCADE');
    for (const price of [49999, 50000, 50001, 30000, 20000, 1]) {
      await pool.query("INSERT INTO products(name,description,price,category,stock) VALUES($1,'Producto QA',$2,'Velas de soja',100)", [`Vela QA ${price}`, price]);
    }
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)", [{
      legalName: 'Tienda QA', rut: '76.123.456-0', legalAddress: 'Dirección QA',
      email: 'store@example.test', phone: '+56912345678', preparationDays: 2,
      policiesVersion: 'free-shipping-qa-v1', returnsInstructions: 'Contactar a la tienda'
    }]);
    await pool.query(`INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at,rate_scope)
      VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,TRUE,1,3,TRUE,now(),'comuna'),
      ('Valparaíso','','Blue Express',4500,TRUE,2,4,FALSE,now(),'region')`);
    server = createApp({ pool, config, webpayClient: null, mercadoPagoClient: mp }).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { body, method = body ? 'POST' : 'GET', token, key, headers = {}, origin = config.origin } = {}) {
      const r = await fetch(base + path, { method, headers: {
        ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...headers
      }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json().catch(() => null) };
    }
    const destinations = [
      { region: 'Metropolitana de Santiago', comuna: 'Las Condes', carrier: 'Paket', fee: 3000 },
      { region: 'Valparaíso', comuna: 'Viña del Mar', carrier: 'Blue Express', fee: 4500 }
    ];
    const payload = (id, place, total) => ({
      customer: { fullName: 'Cliente QA', email: 'customer@example.test', phone: '+56912345678',
        region: place.region, comuna: place.comuna, address: 'Dirección QA 123' },
      items: [{ id, quantity: 1 }], expectedTotal: total, acceptTerms: true,
      termsVersion: 'free-shipping-qa-v1', paymentProvider: 'mercadopago'
    });
    const quote = items => request('/api/checkout/quote', { body: { items } });
    const orders = [];
    async function create(body) {
      const key = randomUUID(), r = await request('/api/orders', { body, key });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      return { ...r.data, key, body };
    }
    const read = order => request(`/api/orders/${order.orderId}`, { token: order.accessToken });
    async function pay(order) {
      const r = await request(`/api/orders/${order.orderId}/pay`, { method: 'POST', token: order.accessToken });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const checkout = (await pool.query('SELECT * FROM mercadopago_checkouts WHERE order_id=$1', [order.orderId])).rows[0];
      return preferences.get(checkout.preference_id);
    }
    await t.test('publica la regla y la cotización usa los precios reales del catálogo', async () => {
      assert.deepEqual((await request('/api/store')).data.shippingPolicy, { freeFromClp: 50000 });
      for (const [id, amount, eligible] of [[1, 49999, false], [2, 50000, true], [3, 50001, true]]) {
        const r = await quote([{ id, quantity: 1, price: 999999 }]);
        assert.equal(r.status, 200); assert.equal(r.data.subtotal, amount);
        assert.equal(r.data.freeShippingEligible, eligible); assert.equal(r.data.freeShippingFromClp, 50000);
      }
    });
    await t.test('aplica el umbral inclusivo a ambos transportistas y guarda el costo definitivo', async () => {
      for (const place of destinations) for (const [id, subtotal] of [[1, 49999], [2, 50000], [3, 50001]]) {
        const fee = subtotal >= 50000 ? 0 : place.fee;
        const order = await create(payload(id, place, subtotal + fee)); orders.push(order);
        const saved = (await read(order)).data;
        assert.equal(saved.subtotal, subtotal); assert.equal(saved.shipping, fee);
        assert.equal(saved.total, subtotal + fee); assert.equal(saved.carrier, place.carrier);
        assert.equal(saved.deliveryDaysMin, place.carrier === 'Paket' ? 3 : 4);
        assert.equal(saved.deliveryDaysMax, place.carrier === 'Paket' ? 5 : 6);
      }
      const rates = (await pool.query('SELECT price_clp FROM shipping_rates_comunas ORDER BY price_clp')).rows;
      assert.deepEqual(rates.map(r => r.price_clp), [3000, 4500]);
    });
    await t.test('no abre destinos sin cobertura ni acepta un subtotal o envío inventado', async () => {
      const unavailable = payload(3, { region: 'Coquimbo', comuna: 'La Serena' }, 50001);
      assert.equal((await request('/api/orders', { body: unavailable, key: randomUUID() })).status, 409);
      const forged = { ...payload(1, destinations[0], 49999), subtotal: 999999, shippingCost: 0, freeShippingEligible: true };
      assert.equal((await request('/api/orders', { body: forged, key: randomUUID() })).status, 409);
    });
    await t.test('el beneficio considera la suma de productos y se recalcula al cambiar el carrito', async () => {
      const exact = [{ id: 4, quantity: 1 }, { id: 5, quantity: 1 }];
      const above = [...exact, { id: 6, quantity: 1 }];
      assert.equal((await quote(exact)).data.freeShippingEligible, true);
      assert.equal((await quote(above)).data.freeShippingEligible, true);
      const atThreshold = await create({ ...payload(4, destinations[0], 50000), items: exact });
      const free = await create({ ...payload(4, destinations[1], 50001), items: above });
      assert.equal((await read(atThreshold)).data.shipping, 0);
      assert.equal((await read(free)).data.shipping, 0);
      assert.equal((await quote([{ id: 5, quantity: 1 }])).data.freeShippingEligible, false);
    });
    await t.test('un pedido guardado conserva su total aunque cambien precios y tarifas', async () => {
      const order = orders[5];
      await pool.query('UPDATE products SET price=1 WHERE id=3');
      await pool.query("UPDATE shipping_rates_comunas SET price_clp=9000 WHERE carrier='Blue Express'");
      const retry = await request('/api/orders', { body: order.body, key: order.key });
      assert.equal(retry.status, 201); assert.equal(retry.data.orderId, order.orderId); assert.equal(retry.data.total, 50001);
      assert.equal((await quote([{ id: 3, quantity: 1 }])).data.freeShippingEligible, false);
      assert.equal((await request('/api/orders', { body: order.body, key: randomUUID() })).status, 409);
    });
    await t.test('Mercado Pago cobra solo los productos del pedido gratis y los correos conservan ese total', async () => {
      for (const order of [orders[1], orders[4]]) {
        const pref = await pay(order);
        assert.ok(pref.items.every(i => i.id !== 'shipping'));
        assert.equal(pref.items.reduce((n, i) => n + i.unit_price * i.quantity, 0), 50000);
        const id = String(++paymentId), merchantId = String(paymentId + 1000000), date = new Date().toISOString();
        payments.set(id, { id: Number(id), external_reference: pref.external_reference, collector_id: 123456,
          currency_id: 'CLP', live_mode: false, transaction_amount: 50000, transaction_amount_refunded: 0,
          status: 'approved', status_detail: 'accredited', captured: true, payment_method_id: 'visa',
          payment_type_id: 'credit_card', date_approved: date, date_last_updated: date,
          order: { id: merchantId, type: 'mercadopago' }, metadata: pref.metadata });
        merchants.set(merchantId, { id: Number(merchantId), preference_id: pref.id, external_reference: pref.external_reference,
          collector: { id: 123456 }, site_id: 'MLC', payments: [{ id: Number(id) }] });
        const ts = String(Math.floor(Date.now() / 1000)), requestId = randomUUID();
        const signature = createHmac('sha256', config.mpWebhookSecret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
        const event = () => request(`/api/payments/mercadopago/webhook?data.id=${id}&type=payment`, {
          origin: null, body: { type: 'payment', data: { id } },
          headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` }
        });
        assert.equal((await event()).status, 200); assert.equal((await event()).status, 200);
        const saved = (await read(order)).data;
        assert.equal(saved.paymentStatus, 'paid'); assert.equal(saved.shipping, 0); assert.equal(saved.total, 50000);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM order_email_outbox WHERE order_id=$1', [order.orderId])).rows[0].n, 2);
      }
      const charged = await pay(orders[0]);
      assert.equal(charged.items.find(i => i.id === 'shipping').unit_price, 3000);
      process.env.EMAIL_TEST_TO = 'qa@example.test';
      const sent = [];
      await sendEmailsOnce(pool, { ...config, emailMode: 'test' }, { emails: { send: async msg => {
        sent.push(msg); return { data: { id: randomUUID() } };
      } } });
      assert.equal(sent.length, 4);
      for (const email of sent) {
        assert.match(email.text, /Despacho \((Paket|Blue Express)\): Gratis/);
        assert.ok(email.html.includes('Gratis')); assert.ok(email.text.includes('$50.000'));
        if (email.attachments) assert.match(Buffer.from(email.attachments[0].content, 'base64').toString('utf8'), /Despacho (Paket|Blue Express): Gratis/);
      }
    });
    await t.test('el retiro sigue siendo gratuito también bajo el monto del beneficio', async () => {
      const order = await create({ ...payload(1, destinations[0], 49999), deliveryMethod: 'pickup',
        customer: { fullName: 'Cliente QA', email: 'customer@example.test', phone: '+56912345678' } });
      const saved = (await read(order)).data;
      assert.equal(saved.deliveryMethod, 'pickup'); assert.equal(saved.shipping, 0); assert.equal(saved.total, 49999);
    });
  } finally {
    if (server) await new Promise(r => server.close(r));
    await pool.end();
  }
});
