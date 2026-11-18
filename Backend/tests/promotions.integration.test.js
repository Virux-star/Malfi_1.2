import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { createApp } from '../app.js';
import { migrate } from '../scripts/migrate.js';
import { chileToday } from '../services/workshops.js';
import { releaseExpiredOrders } from '../services/payments.js';
import { compactOrderEmail } from '../services/compactOrderEmail.js';

const url = process.env.TEST_DATABASE_URL;
test('ofertas y cupones con PostgreSQL y pagos simulados', { skip: !url }, async t => {
  assert.match(new URL(url).pathname, /(?:test|qa)/i);
  const pool = new pg.Pool({ connectionString: url });
  const secret = 'qa-promotions-session-integration-only-000000';
  process.env.SESSION_SECRET = secret;
  const config = { production: false, origin: 'http://localhost:5173', apiOrigin: 'http://localhost:3000',
    enabled: true, emailMode: 'disabled', secret, mode: 'disabled', flowMode: 'integration',
    flowApiKey: 'qa-flow', flowSecretKey: 'qa-secret', flowPublicOrigin: 'https://qa.example.test',
    mpMode: 'integration', mpAccessToken: 'qa-mp', mpWebhookSecret: 'qa-secret-mp', mpCollectorId: '123456', mpPublicOrigin: 'https://qa.example.test' };
  const sent = {};
  const mp = { getSeller: async () => ({ id: 123456, site_id: 'MLC', tags: ['test_user'] }),
    createPreference: async body => { sent.mp = body; return { ...body, id: 'pref_qa_promo', collector_id: 123456,
      init_point: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref_qa_promo' }; } };
  const flow = { createPayment: async body => { sent.flow = body; return { flowOrder: 123456, token: 'qa_flow_' + randomUUID(),
    url: 'https://sandbox.flow.cl/app/web/pay.php' }; } };
  let server, cookie, offer, coupon, order;
  const today = chileToday();
  const rule = { kind: 'offer', name: 'Velas del día', percent: 40, starts_on: today, ends_on: today,
    category: 'Velas de soja', product_ids: [], min_subtotal: 0, max_uses: null };
  const items = [{ id: 1, quantity: 2 }, { id: 2, quantity: 2 }];
  const customer = { fullName: 'Cliente QA', email: 'buyer@example.test', phone: '+56900000000',
    region: 'Metropolitana de Santiago', comuna: 'Las Condes', address: 'Dirección de prueba' };
  const orderBody = { customer, items, couponCode: 'promo15', paymentProvider: 'flow',
    acceptTerms: true, termsVersion: 'qa-promos', expectedTotal: 42600 };
  try {
    await migrate(pool);
    await pool.query('TRUNCATE orders, products, promotions, shipping_rates_comunas, store_settings, admin_sessions, admin_users RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO products(name,price,category,stock) VALUES('Vela',28000,'Velas de soja',50),('Insumo',3500,'Insumos',50)");
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1)", [{ legalName: 'MALFI QA',
      rut: '11.111.111-1', legalAddress: 'Dirección QA', email: 'qa@example.test', phone: '+56900000000', policiesVersion: 'qa-promos' }]);
    await pool.query("INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at) VALUES('Metropolitana de Santiago','Las Condes','Paket',3000,TRUE,1,3,TRUE,now())");
    await pool.query('INSERT INTO admin_users(email,password_hash) VALUES($1,$2)', ['admin@example.test', await bcrypt.hash(secret, 4)]);
    server = createApp({ pool, config, webpayClient: null, mercadoPagoClient: mp, flowClient: flow }).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    async function req(path, { body, method = body ? 'POST' : 'GET', admin, key, token } = {}) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method,
        headers: { Origin: config.origin, 'Content-Type': 'application/json', ...(admin ? { Cookie: cookie } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json(), headers: response.headers };
    }
    const adminPath = '/api/admin/promotions';
    const quote = (code, lines = items) => req('/api/checkout/quote', { body: { items: lines, couponCode: code } });
    const makeOrder = (body, key = randomUUID()) => req('/api/orders', { body, key });
    const pay = o => req('/api/orders/' + o.orderId + '/pay', { method: 'POST', token: o.accessToken });
    const create = async body => { const r = await req(adminPath, { admin: true, body }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
    await t.test('solo administración configura fechas, ámbito, porcentaje y códigos únicos', async () => {
      assert.equal((await req(adminPath)).status, 401);
      assert.equal((await req(adminPath, { body: rule })).status, 401);
      const login = await req('/api/admin/login', { body: { email: 'admin@example.test', password: secret } });
      cookie = login.headers.get('set-cookie').split(';')[0];
      for (const invalid of [{ percent: 100 }, { ends_on: '2020-01-01' }, { category: null, product_ids: [999] }])
        assert.equal((await req(adminPath, { admin: true, body: { ...rule, ...invalid } })).status, 400);
      offer = await create(rule);
      coupon = await create({ ...rule, kind: 'coupon', name: 'Código general', category: null, percent: 15, code: 'promo15' });
      assert.equal(coupon.code, 'PROMO15');
      assert.equal((await req(adminPath, { admin: true, body: coupon })).status, 409);
      await create({ ...rule, starts_on: '2099-01-01', ends_on: '2099-01-02', percent: 90 });
      await create({ ...rule, starts_on: '2000-01-01', ends_on: '2000-01-02', percent: 99 });
    });
    await t.test('el catálogo y la ficha muestran solo ofertas vigentes; un cupón solo mejora líneas elegibles', async () => {
      const catalog = (await req('/api/products')).data, detail = (await req('/api/products/1')).data;
      assert.equal(detail.originalPrice, 28000); assert.equal(detail.price, 16800);
      assert.equal(catalog.find(p => p.id === 1).offerPercent, 40); assert.equal(catalog.find(p => p.id === 2).price, 3500);
      assert.ok(!JSON.stringify(catalog).includes('PROMO15'));
      const q = (await quote(' pRoMo15 ')).data;
      assert.equal(q.originalSubtotal, 63000); assert.equal(q.subtotal, 39550); assert.equal(q.discount, 23450);
      assert.equal(q.freeShippingEligible, false); assert.equal(q.couponCode, 'PROMO15');
      assert.deepEqual(q.items.map(i => i.price), [16800, 2975]);
      assert.equal((await quote('PROMO15', [{ id: 1, quantity: 1 }])).status, 409);
      assert.equal((await quote('INEXISTENTE')).status, 409);
      assert.equal((await quote('', items)).data.subtotal, 40600);
    });
    await t.test('Flow y Mercado Pago reciben exactamente el total revisado, incluido el despacho', async () => {
      const stale = await makeOrder(orderBody);
      assert.equal(stale.status, 409);
      orderBody.expectedTotal = 42550;
      const key = randomUUID();
      const r = await makeOrder(orderBody, key); assert.equal(r.status, 201, JSON.stringify(r.data)); order = r.data;
      assert.equal((await makeOrder(orderBody, key)).data.orderId, order.orderId);
      assert.equal((await makeOrder({ ...orderBody, couponCode: '' }, key)).status, 409);
      assert.equal((await pay(order)).status, 200); assert.equal(sent.flow.amount, 42550);
      const mpOrder = await makeOrder({ ...orderBody, paymentProvider: 'mercadopago' });
      assert.equal(mpOrder.status, 201); assert.equal((await pay(mpOrder.data)).status, 200);
      assert.equal(sent.mp.items.reduce((sum, line) => sum + line.unit_price * line.quantity, 0), 42550);
      assert.equal(sent.mp.items.find(i => i.id === 'shipping').unit_price, 3000);
      assert.deepEqual(sent.mp.items.filter(i => i.id !== 'shipping').map(i => i.unit_price), [16800, 2975]);
    });
    await t.test('editar o pausar conserva el ahorro, el cupón y los precios de pedidos existentes y sus correos', async () => {
      await req(adminPath + '/' + offer.id, { method: 'PATCH', body: { enabled: false }, admin: true });
      assert.equal((await req('/api/products/1')).data.price, 28000);
      await req(adminPath + '/' + coupon.id, { method: 'PUT', body: { ...coupon, min_subtotal: 64000 }, admin: true });
      assert.equal((await quote('promo15')).status, 409);
      const saved = (await req('/api/orders/' + order.orderId, { token: order.accessToken })).data;
      assert.equal(saved.discount, 23450); assert.equal(saved.couponCode, 'PROMO15'); assert.equal(saved.total, 42550);
      const adminOrder = (await req('/api/admin/orders/' + order.orderId, { admin: true })).data;
      assert.equal(Number(adminOrder.discount_clp), 23450);
      const row = (await pool.query('SELECT * FROM orders WHERE id=$1', [order.orderId])).rows[0];
      const mail = compactOrderEmail('payment_confirmed', row, saved.items, config, 'Comprobante QA');
      assert.match(mail.text, /PROMO15/); assert.match(mail.html, /23\.450/);
    });
    await t.test('dos pedidos simultáneos respetan el último uso y al vencer la reserva vuelve a quedar disponible', async () => {
      const limited = await create({ ...rule, kind: 'coupon', name: 'Una compra', code: 'UNUSO', percent: 40, category: null,
        product_ids: [1, 2], max_uses: 1 });
      const checkout = id => ({ ...orderBody, couponCode: limited.code, items: [{ id, quantity: 1 }], deliveryMethod: 'pickup',
        expectedTotal: id === 1 ? 16800 : 2100 });
      const attempts = await Promise.all([makeOrder(checkout(1)), makeOrder(checkout(2))]);
      assert.deepEqual(attempts.map(a => a.status).sort(), [201, 409]);
      assert.equal((await quote(limited.code)).status, 409);
      const winner = attempts.find(a => a.status === 201).data;
      await pool.query("UPDATE orders SET expires_at=now()-interval '1 hour' WHERE id=$1", [winner.orderId]);
      await releaseExpiredOrders(pool);
      assert.equal((await quote(limited.code)).status, 200);
      const list = (await req(adminPath, { admin: true })).data;
      assert.equal(list.find(r => r.id === limited.id).uses, 0);
    });
  } finally {
    if (server) await new Promise(r => server.close(r));
    // Subsequent integration suites share this isolated database.
    await pool.query('UPDATE promotions SET enabled=false');
    await pool.end();
  }
});
