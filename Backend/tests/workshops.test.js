import test from 'node:test';
import assert from 'node:assert/strict';
import { chileToday, validWorkshopDate, workshopDateList, formatWorkshopDate } from '../services/workshops.js';
import { normalizeCartLines, selectedOptions, publicProduct, orderItemDescription } from '../services/productOptions.js';
import { compactOrderEmail } from '../services/compactOrderEmail.js';
import { orderEmail } from '../services/commerceWorker.js';

const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const later = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

test('las fechas usan el día de Chile y rechazan fechas inexistentes o estructuras arbitrarias', () => {
  assert.equal(chileToday(new Date('2026-11-18T01:00:00Z')), '2026-11-17');
  assert.equal(validWorkshopDate('2028-02-29'), true);
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-1-2', '2026-01-01T00:00Z', {}, 20261117, null]) {
    assert.equal(validWorkshopDate(invalid), false);
    assert.throws(() => workshopDateList([invalid]));
  }
  assert.deepEqual(workshopDateList(JSON.stringify([later, future, future])), [future, later]);
  assert.throws(() => workshopDateList(Array(21).fill(future)));
  assert.throws(() => workshopDateList('{}'));
});

test('el servidor exige una fecha vigente ofrecida por el taller y rechaza fechas en otros productos', () => {
  const product = { name: 'Taller', category: 'Talleres', stock: 8, workshop_dates: ['2001-01-01', future, later] };
  assert.equal(selectedOptions(product, { workshopDate: future }).workshopDate, future);
  for (const workshopDate of ['', '2001-01-01', '2099-01-01']) {
    assert.throws(() => selectedOptions(product, { workshopDate }), { status: 409 });
  }
  assert.throws(() => selectedOptions({ name: 'Cera', category: 'Insumos' }, { workshopDate: future }), { status: 409 });
  assert.deepEqual(publicProduct(product).workshop_dates, [future, later]);
  assert.deepEqual(publicProduct(product, true).workshop_dates, product.workshop_dates);
  const lines = normalizeCartLines([{ id: 1, quantity: 2, workshopDate: future }, { id: 1, quantity: 1, workshopDate: later }]);
  assert.equal(lines.length, 2);
  assert.throws(() => normalizeCartLines([{ id: 1, quantity: 1, workshopDate: future }, { id: 1, quantity: 2, workshopDate: future }]));
  assert.throws(() => normalizeCartLines([{ id: 1, quantity: 1, workshopDate: {} }]));
});

test('los correos al cliente y al negocio conservan la fecha de cada taller sin cambiar el día', () => {
  const item = { product_name: 'Taller QA', selected_workshop_date: future, selected_workshop_time: 'PM', quantity: 2, unit_price_clp: 25000, line_total_clp: 50000 };
  const date = formatWorkshopDate(future);
  assert.ok(orderItemDescription(item).includes('Fecha: ' + date));
  const order = { id: 1, checkout_key: 'qa', payment_mode: 'integration', customer_name: 'QA', delivery_days_max: 2,
    subtotal_clp: 50000, shipping_clp: 0, total_clp: 50000, business_snapshot: { email: 'qa@example.test' } };
  const config = { origin: 'https://qa.example.test', secret: 'workshops-qa-secret' };
  for (const kind of ['payment_confirmed', 'admin_new_order']) {
    const original = orderEmail(kind, order, [item], config);
    for (const email of [original, compactOrderEmail(kind, order, [item], config, original.text)]) {
      assert.ok(email.text.includes('Horario: PM'));
      assert.ok(email.html.includes('Horario: PM'));
      assert.ok(email.text.includes('Fecha: ' + date));
      assert.ok(email.html.includes('Fecha: ' + date));
    }
  }
});

test('el horario debe pertenecer al taller y estar bien formado', () => {
  const line = {id: 1, quantity: 1, workshopDate: future, workshopTime: ' am '};
  const [normalized] = normalizeCartLines([line]);
  const product = {name: 'Taller', category: 'Talleres', workshop_dates: [future], workshop_times: ['AM', 'PM']};
  assert.equal(selectedOptions(product, normalized).workshopTime, 'AM');
  assert.throws(() => normalizeCartLines([line, {...line, workshopTime:'AM'}]));
  for (const time of [{}, 'a'.repeat(61), 'AM\nPM']) assert.throws(() => normalizeCartLines([{...line, workshopTime:time}]));
  assert.throws(() => selectedOptions({category:'Insumos'}, {workshopTime:'AM'}), {status:409});
  assert.throws(() => selectedOptions({...product, workshop_times:[]}, normalized), {status:409});
});
