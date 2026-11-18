import { chileToday, validWorkshopDate } from './workshops.js';

const fold = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
export const cartKey = item => {
  const time = item.workshopTime ?? item.selected_workshop_time;
  return JSON.stringify([Number(item.id ?? item.product_id), fold(item.color ?? item.selected_color), fold(item.aroma ?? item.selected_aroma), item.workshopDate ?? item.selected_workshop_date ?? '', ...(time ? [fold(time)] : [])]);
};
export const productQuantity = (items, id) => items.filter(item => item.id === Number(id)).reduce((n, item) => n + item.quantity, 0);
const choice = value => typeof value === 'string' && value.length <= 60 && !/[\u0000-\u001f\u007f]/.test(value);

export function restoreCart(value) {
  if (!Array.isArray(value)) return [];
  const result = [], seen = new Map(), limits = new Map();
  for (const raw of value) {
    if (!Number.isInteger(raw?.id) || raw.id < 1 || typeof raw.name !== 'string' ||
      !Number.isInteger(raw.price) || raw.price < 1 || !Number.isInteger(raw.stock) || raw.stock < 1 ||
      !Number.isInteger(raw.quantity) || raw.quantity < 1 ||
      !choice(raw.color ?? '') || !choice(raw.aroma ?? '') || !choice(raw.workshopTime ?? '') ||
      (raw.workshopTime && (raw.category !== 'Talleres' || !raw.workshopDate)) ||
      ((raw.workshopDate ?? '') !== '' && !validWorkshopDate(raw.workshopDate))) continue;
    const item = { id: raw.id, name: raw.name, price: raw.price, stock: Math.min(raw.stock, 100),
      quantity: raw.quantity, image_url: raw.image_url || null, color: raw.color || '', aroma: raw.aroma || '',
      category: typeof raw.category === 'string' ? raw.category : '', workshopDate: raw.workshopDate || '', workshopTime: raw.workshopTime || '' };
    item.key = cartKey(item);
    limits.set(item.id, Math.min(limits.get(item.id) ?? 100, item.stock));
    if (seen.has(item.key)) seen.get(item.key).quantity += item.quantity;
    else if (result.length < 30) { seen.set(item.key, item); result.push(item); }
  }
  const used = new Map();
  return result.map(item => {
    const stock = limits.get(item.id), quantity = Math.min(item.quantity, Math.max(0, stock - (used.get(item.id) || 0)));
    used.set(item.id, (used.get(item.id) || 0) + quantity);
    return { ...item, stock, quantity };
  }).filter(item => item.quantity > 0);
}

export function addCartItem(items, product, quantity = 1, options = {}) {
  const stock = Math.min(Number(product.stock), 100), amount = Number(quantity);
  if (!Number.isInteger(stock) || stock < 1 || !Number.isInteger(amount) || amount < 1) return items;
  const color = options.color || '', aroma = options.aroma || '', workshopDate = options.workshopDate ?? '';
  if (product.category === 'Talleres' ? !validWorkshopDate(workshopDate) || workshopDate < chileToday() || !product.workshop_dates?.includes(workshopDate) : workshopDate !== '') return items;
  const workshopTime = options.workshopTime ?? '';
  const times = product.category === 'Talleres' ? product.workshop_times || [] : [];
  if (times.length ? !times.includes(workshopTime) : workshopTime !== '') return items;
  if (![color, aroma, workshopTime].every(choice)) return items;
  if ((product.colors?.length ? !product.colors.includes(color) : color) ||
    (product.aromas?.length ? !product.aromas.includes(aroma) : aroma)) return items;
  const remaining = stock - productQuantity(items, product.id);
  if (remaining <= 0) return items;
  const item = { id: product.id, name: product.name, price: product.price, image_url: product.image_url || null,
    stock, color, aroma, workshopDate, workshopTime, category: product.category || '', quantity: Math.min(amount, remaining) };
  item.key = cartKey(item);
  const index = items.findIndex(row => row.key === item.key);
  if (index < 0) return items.length >= 30 ? items : [...items, item];
  return items.map((row, i) => i === index ? { ...item, quantity: row.quantity + item.quantity } : row.id === item.id ? { ...row, stock } : row);
}

export function setCartQuantity(items, key, value) {
  const row = items.find(item => item.key === key);
  if (!row) return items;
  const other = productQuantity(items, row.id) - row.quantity;
  const quantity = Math.min(Math.max(1, Math.floor(Number(value)) || 1), Math.max(1, row.stock - other));
  return items.map(item => item.key === key ? { ...item, quantity } : item);
}

export function subtractPurchased(items, purchased) {
  const quantities = new Map();
  for (const row of purchased) {
    const key = cartKey(row);
    quantities.set(key, (quantities.get(key) || 0) + row.quantity);
  }
  return items.map(item => ({ ...item, quantity: item.quantity - (quantities.get(item.key) || 0) })).filter(item => item.quantity > 0);
}
