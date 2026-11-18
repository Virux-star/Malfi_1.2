import { rateLimit } from 'express-rate-limit';
import { catalogPrices, priceCart, couponCode, categories } from '../services/promotions.js';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { optionList, publicProduct, MAX_PHOTOS, normalizeCartLines, galleryOrder } from '../services/productOptions.js';
import { qualifiesForFreeShipping } from '../services/shipping.js';
import { shippingPolicy } from '../config/fulfillment.js';
import { workshopDateList, chileToday } from '../services/workshops.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = id => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;
const fields = 'id,name,description,price,category,stock,reserved_stock,image_url,image_gallery,colors,aromas,workshop_dates,workshop_times,sand_colors,active,created_at';

function productForm(body) {
  const name = String(body.name ?? '').trim(), description = String(body.description ?? '').trim();
  const price = Number(body.price), stock = Number(body.stock), category = String(body.category ?? '');
  if (!name || name.length > 150) throw fail('El nombre debe tener entre 1 y 150 caracteres.');
  if (description.length > 2000) throw fail('La descripción admite hasta 2000 caracteres.');
  if (!String(body.price ?? '').trim() || !Number.isInteger(price) || price < 1 || price > 2147483647) throw fail('Precio no válido.');
  if (!String(body.stock ?? '').trim() || !Number.isInteger(stock) || stock < 0 || stock > 2147483647) throw fail('Stock no válido.');
  if (!categories.includes(category)) throw fail('Categoría no válida.');
  return { name, description, price, stock, category };
}

function retainedPhotos(body, existing, legacyReplacement) {
  const gallery = Array.isArray(existing?.image_gallery) ? existing.image_gallery : [];
  if (body.keepImages === undefined) return legacyReplacement ? gallery.slice(1) : gallery;
  let urls;
  try { urls = typeof body.keepImages === 'string' ? JSON.parse(body.keepImages) : body.keepImages; }
  catch { throw fail('La lista de fotografías no es válida.'); }
  if (!Array.isArray(urls) || urls.length > MAX_PHOTOS || new Set(urls).size !== urls.length) throw fail('Revisa las fotografías conservadas.');
  return urls.map(url => {
    const found = gallery.find(image => image.url === url);
    if (!found) throw fail('Una fotografía cambió. Actualiza la lista de productos.', 409);
    return found;
  });
}

export function registerProductRoutes(app, pool, requireAdmin, uploadLimiter, imageClient) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: MAX_PHOTOS, fields: 12, parts: 20 } })
    .fields([{ name: 'image', maxCount: 1 }, { name: 'images', maxCount: MAX_PHOTOS }]);
  const photos = (req, res, next) => upload(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Admite hasta 6 fotografías JPG, PNG o WebP de 5 MB cada una.' });
  });
  const handle = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
  };

  app.get('/api/products', handle(async (req, res) => {
    const result = await pool.query('SELECT ' + fields + ' FROM products WHERE active=TRUE ORDER BY created_at DESC,id DESC');
    res.json(await catalogPrices(pool, result.rows));
  }));
  app.get('/api/products/:id', handle(async (req, res) => {
    if (!validId(req.params.id)) throw fail('ID de producto no válido.');
    const result = await pool.query('SELECT ' + fields + ' FROM products WHERE id=$1 AND active=TRUE', [req.params.id]);
    if (!result.rowCount) throw fail('Producto no encontrado.', 404);
    res.json((await catalogPrices(pool, result.rows))[0]);
  }));
  app.get('/api/admin/products', requireAdmin, handle(async (req, res) => {
    const result = await pool.query('SELECT ' + fields + ' FROM products ORDER BY id DESC');
    res.json(result.rows.map(product => publicProduct(product, true)));
  }));

  async function save(req, res) {
    const editing = req.method === 'PUT';
    if (editing && !validId(req.params.id)) throw fail('ID de producto no válido.');
    const form = productForm(req.body);
    let existing = null;
    if (editing) {
      existing = (await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
      if (!existing) throw fail('Producto no encontrado.', 404);
    }
    const colors = optionList(req.body.colors ?? existing?.colors, 'colores');
    const aromas = optionList(req.body.aromas ?? existing?.aromas, 'aromas');
    const sandColors = editing && req.body.sandColors == null ? null : optionList(req.body.sandColors, 'colores de vela arena');
    const times = form.category === 'Talleres' ? optionList(req.body.workshopTimes ?? existing?.workshop_times, 'horarios') : [];
    const dates = form.category === 'Talleres' ? workshopDateList(req.body.workshopDates ?? existing?.workshop_dates) : [];
    if (form.category === 'Talleres' && (!dates.length || (form.stock > 0 && !dates.some(date => date >= chileToday())))) {
      throw fail('Agrega al menos una fecha disponible para publicar el taller.');
    }
    if (req.files?.image?.length && req.files?.images?.length) throw fail('Utiliza un solo selector de fotografías.');
    const incoming = req.files?.images || req.files?.image || [];
    const legacy = Boolean(req.files?.image?.length);
    const kept = retainedPhotos(req.body, existing, legacy);
    if (kept.length + incoming.length > MAX_PHOTOS || kept.length + incoming.length < 1) throw fail('El producto debe tener entre 1 y 6 fotografías.');
    for (const image of incoming) {
      const detected = await fileTypeFromBuffer(image.buffer);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(detected?.mime)) throw fail('Utiliza fotografías JPG, PNG o WebP.');
    }
    const order = galleryOrder(req.body.photoOrder, kept.map(image => image.url), incoming.length);
    const uploaded = [];
    let db, committing = false, committed = false;
    try {
      for (const image of incoming) {
        const result = await new Promise((resolve, reject) => {
          const stream = imageClient.uploader.upload_stream({ folder: 'malfi/products', resource_type: 'image' }, (error, value) => error ? reject(error) : resolve(value));
          stream.end(image.buffer);
        });
        uploaded.push({ url: result.secure_url, public_id: result.public_id });
      }
      const photoMap = new Map([...kept.map(image => [image.url, image]), ...uploaded.map((image, index) => ['new:' + index, image])]);
      const gallery = legacy && req.body.keepImages === undefined && req.body.photoOrder === undefined ? [...uploaded, ...kept] : order.map(key => photoMap.get(key));
      db = await pool.connect();
      await db.query('BEGIN');
      if (editing) {
        const current = (await db.query('SELECT stock,reserved_stock,image_gallery FROM products WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!current || JSON.stringify(current.image_gallery) !== JSON.stringify(existing.image_gallery)) throw fail('El producto cambió. Actualiza la lista antes de guardar.', 409);
        if (form.stock < current.reserved_stock) throw fail('El stock no puede ser menor que las unidades reservadas.', 409);
      }
      const values = [form.name, form.description, form.price, form.category, form.stock, gallery[0].url, gallery[0].public_id, colors, aromas, JSON.stringify(gallery), dates, times, sandColors];
      const query = editing
        ? 'UPDATE products SET name=$1,description=$2,price=$3,category=$4,stock=$5,image_url=$6,image_public_id=$7,colors=$8,aromas=$9,image_gallery=$10::jsonb,workshop_dates=$11,workshop_times=$12,sand_colors=COALESCE($13,sand_colors) WHERE id=$14 RETURNING ' + fields
        : 'INSERT INTO products(name,description,price,category,stock,image_url,image_public_id,colors,aromas,image_gallery,workshop_dates,workshop_times,sand_colors) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING ' + fields;
      if (editing) values.push(req.params.id);
      const result = await db.query(query, values);
      committing = true;
      await db.query('COMMIT');
      committed = true;
      // Remove only server-owned files no longer referenced by the saved gallery.
      for (const old of existing?.image_gallery || []) {
        if (old.public_id && !gallery.some(image => image.public_id === old.public_id)) {
          try { await imageClient.uploader.destroy(old.public_id, { invalidate: true }); }
          catch { console.error('No se pudo limpiar una fotografía anterior del producto.'); }
        }
      }
      res.status(editing ? 200 : 201).json({ message: editing ? 'Producto actualizado correctamente.' : 'Producto registrado correctamente.', product: publicProduct(result.rows[0], true) });
    } catch (error) {
      if (db && !committed) { try { await db.query('ROLLBACK'); } catch {} }
      // A failed COMMIT reply is uncertain: retain uploads instead of deleting possibly referenced files.
      if (!committing) for (const image of uploaded) {
        try { await imageClient.uploader.destroy(image.public_id); } catch { console.error('No se pudo limpiar una fotografía nueva.'); }
      }
      throw error;
    } finally { db?.release(); }
  }

  app.post('/api/admin/products', uploadLimiter, requireAdmin, photos, handle(save));
  app.put('/api/admin/products/:id', uploadLimiter, requireAdmin, photos, handle(save));

  const couponLimit = rateLimit({ windowMs: 60000, limit: 40, skip: req => !req.body?.couponCode,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Espera un minuto antes de volver a probar el cupón.' } });
  app.post('/api/checkout/quote', couponLimit, handle(async (req, res) => {
    const items = normalizeCartLines(req.body?.items);
    const { couponId, ...quote } = await priceCart(pool, items, couponCode(req.body?.couponCode));
    res.json({ ...quote, shipping: null, freeShippingEligible: qualifiesForFreeShipping(quote.subtotal),
      freeShippingFromClp: shippingPolicy.freeFromClp, currency: 'CLP' });
  }));
}
