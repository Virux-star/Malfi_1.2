import { publicProduct, quantityByProduct, selectedOptions } from './productOptions.js';
import { chileToday } from './workshops.js';

const invalid = (message, status = 409) => Object.assign(new Error(message), { status });
export const categories = ['Velas de soja', 'Decoración de concreto', 'Set de velas', 'Talleres', 'Insumos'];
export const promotionFields = 'id,kind,name,code,percent,starts_on::text,ends_on::text,category,product_ids,min_subtotal,max_uses,enabled';
export const countsAsUse = "(inventory_reserved OR payment_status IN ('paid','refunded') OR paid_at IS NOT NULL)";

export function couponCode(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^[A-Z0-9_-]{1,32}$/i.test(value.trim())) {
    throw invalid('Usa un código de hasta 32 letras, números, guiones o guiones bajos.', 400);
  }
  return value.trim().toUpperCase();
}

async function activePromotions(db, code = '', lock = false) {
  const result = await db.query(`SELECT ${promotionFields} FROM promotions
    WHERE enabled AND $1::date BETWEEN starts_on AND ends_on AND (kind='offer' OR code=$2)
    ORDER BY percent DESC, id ${lock ? 'FOR SHARE' : ''}`, [chileToday(), code]);
  return result.rows;
}

function eligible(rule, product) {
  if (rule.category) return rule.category === product.category;
  return !rule.product_ids.length || rule.product_ids.includes(product.id);
}

function bestPrice(product, rules) {
  let price = product.price, winner = null;
  for (const rule of rules) {
    if (!eligible(rule, product)) continue;
    const candidate = Math.max(1, Math.round(product.price * (100 - rule.percent) / 100));
    // Keep the automatic price on ties; a coupon use must buy extra savings.
    if (candidate < price || (winner?.kind === 'coupon' && rule.kind === 'offer' && candidate === price)) {
      price = candidate;
      winner = rule;
    }
  }
  return { price, winner };
}

export async function catalogPrices(db, products) {
  const offers = await activePromotions(db);
  return products.map(row => {
    const product = publicProduct(row);
    const { price, winner } = bestPrice(product, offers);
    return winner ? { ...product, originalPrice: product.price, price, offerPercent: winner.percent } : product;
  });
}

export async function priceCart(db, items, code, { reserve = false } = {}) {
  const quantities = quantityByProduct(items);
  const result = await db.query(`SELECT id,name,category,price,stock,reserved_stock,colors,aromas,workshop_dates,workshop_times,image_url,image_gallery
    FROM products WHERE active AND id=ANY($1::int[]) ORDER BY id ${reserve ? 'FOR UPDATE' : ''}`, [[...quantities.keys()]]);
  const byId = new Map(result.rows.map(row => [row.id, publicProduct(row)]));

  // Serialize orders sharing a limited coupon, even when they buy different products.
  if (code && reserve) await db.query('SELECT id FROM promotions WHERE code=$1 FOR UPDATE', [code]);
  const rules = await activePromotions(db, code, reserve);
  const coupon = rules.find(rule => rule.kind === 'coupon');
  if (code && !coupon) throw invalid('El cupón no existe o está fuera de vigencia.');

  let subtotal = 0, originalSubtotal = 0, couponUsed = false;
  const priced = items.map(item => {
    const product = byId.get(item.id);
    if (!product) throw invalid('Uno de los productos ya no está disponible.');
    if (product.stock < quantities.get(item.id)) throw invalid('Stock insuficiente para ' + product.name + '.');
    const { price, winner } = bestPrice(product, rules);
    const lineTotal = price * item.quantity;
    originalSubtotal += product.price * item.quantity;
    subtotal += lineTotal;
    if (winner?.kind === 'coupon') couponUsed = true;
    return { id: item.id, name: product.name, originalPrice: product.price, price, quantity: item.quantity,
      image_url: product.image_url, ...selectedOptions(product, item), line_total: lineTotal,
      promotionName: winner?.name ?? null };
  });
  if (coupon) {
    if (originalSubtotal < coupon.min_subtotal) throw invalid('Este cupón requiere una compra mínima de $' + coupon.min_subtotal.toLocaleString('es-CL') + ' en productos antes de descuentos.');
    if (!couponUsed) throw invalid('El cupón no mejora el precio de los productos de este carrito.');
    if (coupon.max_uses != null) {
      const { rows } = await db.query('SELECT count(*)::int AS uses FROM orders WHERE coupon_id=$1 AND ' + countsAsUse, [coupon.id]);
      if (rows[0].uses >= coupon.max_uses) throw invalid('El cupón alcanzó su límite de usos.');
    }
  }
  return { items: priced, subtotal, originalSubtotal, discount: originalSubtotal - subtotal, couponCode: code || null, couponId: coupon?.id ?? null };
}
