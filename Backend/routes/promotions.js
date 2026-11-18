import { categories, countsAsUse, couponCode, promotionFields } from '../services/promotions.js';
import { validWorkshopDate } from '../services/workshops.js';

const bad = message => Object.assign(new Error(message), { status: 400 });
function readForm(body) {
  const { kind, name, percent, starts_on, ends_on, category, product_ids, min_subtotal, max_uses } = body;
  if (!['offer', 'coupon'].includes(kind) || typeof name !== 'string' || !name.trim() || name.trim().length > 100)
    throw bad('Ingresa un nombre para la promoción.');
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw bad('El descuento debe estar entre 1 y 99 %.');
  if (!validWorkshopDate(starts_on) || !validWorkshopDate(ends_on) || ends_on < starts_on) throw bad('Revisa el inicio y el término de la promoción.');
  if ((category !== null && !categories.includes(category)) || !Array.isArray(product_ids) || product_ids.length > 500 ||
    product_ids.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647) || (category && product_ids.length))
    throw bad('Revisa los productos o la categoría de la promoción.');
  const code = kind === 'coupon' ? couponCode(body.code) : null;
  if (kind === 'coupon' && !code) throw bad('Escribe un código para el cupón.');
  if (!Number.isInteger(min_subtotal) || min_subtotal < 0 || min_subtotal > 999999999 ||
    (max_uses !== null && (!Number.isInteger(max_uses) || max_uses < 1 || max_uses > 999999999)) ||
    (kind === 'offer' && (min_subtotal || max_uses !== null))) throw bad('Revisa el monto mínimo y el límite de usos.');
  return [kind, name.trim(), code, percent, starts_on, ends_on, category, [...new Set(product_ids)], min_subtotal, max_uses];
}

export function registerPromotions(app, pool, requireAdmin) {
  const route = fn => async (req, res, next) => {
    try { await fn(req, res); }
    catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un cupón con ese código.' });
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
  app.get('/api/admin/promotions', requireAdmin, route(async (req, res) => {
    const result = await pool.query(`SELECT ${promotionFields},
      (SELECT count(*)::int FROM orders WHERE coupon_id=promotions.id AND ${countsAsUse}) AS uses
      FROM promotions ORDER BY id DESC`);
    res.json(result.rows);
  }));
  const save = route(async (req, res) => {
    const values = readForm(req.body || {});
    const ids = values[7];
    if (ids.length && (await pool.query('SELECT id FROM products WHERE id=ANY($1::int[])', [ids])).rowCount !== ids.length)
      throw bad('Alguno de los productos seleccionados ya no existe.');
    const result = req.params.id
      ? await pool.query(`UPDATE promotions SET name=$2,code=$3,percent=$4,starts_on=$5,ends_on=$6,category=$7,
        product_ids=$8,min_subtotal=$9,max_uses=$10 WHERE id=$11 AND kind=$1 RETURNING ${promotionFields}`, [...values, req.params.id])
      : await pool.query(`INSERT INTO promotions(kind,name,code,percent,starts_on,ends_on,category,product_ids,min_subtotal,max_uses)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${promotionFields}`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'La promoción no existe o cambió de tipo.' });
    res.status(req.params.id ? 200 : 201).json(result.rows[0]);
  });
  const validId = (req, res, next) => /^[1-9]\d{0,9}$/.test(req.params.id) && Number(req.params.id) <= 2147483647 ? next() : res.status(400).json({ error: 'ID de promoción no válido.' });
  app.post('/api/admin/promotions', requireAdmin, save);
  app.put('/api/admin/promotions/:id', requireAdmin, validId, save);
  app.patch('/api/admin/promotions/:id', requireAdmin, validId, route(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') throw bad('Elige si la promoción está habilitada.');
    const result = await pool.query('UPDATE promotions SET enabled=$2 WHERE id=$1 RETURNING id,enabled', [req.params.id, req.body.enabled]);
    if (!result.rowCount) return res.status(404).json({ error: 'La promoción no existe.' });
    res.json(result.rows[0]);
  }));
}
