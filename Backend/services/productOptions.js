import { chileToday, validWorkshopDate, formatWorkshopDate } from './workshops.js';

export const MAX_OPTIONS = 20;
export const MAX_PHOTOS = 6;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const fold = value => value.normalize('NFKC').toLocaleLowerCase('es');

function label(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw bad('La opción no es válida.');
  const result = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (result.length > 60) throw bad('Cada opción admite hasta 60 caracteres.');
  return result;
}

export function optionList(value, field = 'opciones') {
  let list = value ?? [];
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { throw bad('Revisa la lista de ' + field + '.'); }
  }
  if (!Array.isArray(list) || list.length > MAX_OPTIONS) throw bad('Puedes registrar hasta 20 ' + field + '.');
  const result = [], seen = new Set();
  for (const raw of list) {
    const item = label(raw);
    if (!item) throw bad('Las opciones no pueden estar vacías.');
    const key = fold(item);
    if (!seen.has(key)) { seen.add(key); result.push(item); }
  }
  return result;
}

export function lineKey(item) {
  const time = item.workshopTime ?? item.selected_workshop_time;
  return JSON.stringify([Number(item.id ?? item.product_id), fold(String(item.color ?? item.selected_color ?? '')), fold(String(item.aroma ?? item.selected_aroma ?? '')), item.workshopDate ?? item.selected_workshop_date ?? '', ...(time ? [fold(time)] : [])]);
}

export function normalizeCartLines(value) {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw bad('El carrito debe contener entre 1 y 30 productos.');
  const seen = new Set(), quantities = new Map();
  return value.map(raw => {
    const item = { id: Number(raw?.id), quantity: Number(raw?.quantity),
      color: raw?.color == null ? '' : label(raw.color), aroma: raw?.aroma == null ? '' : label(raw.aroma),
      workshopDate: raw?.workshopDate ?? '', workshopTime: label(raw?.workshopTime ?? '') };
    if (item.workshopDate !== '' && !validWorkshopDate(item.workshopDate)) throw bad('Fecha del taller no válida.');
    if (!Number.isInteger(item.id) || item.id < 1 || item.id > 2147483647 ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw bad('Productos o cantidades no válidos.');
    const key = lineKey(item);
    if (seen.has(key)) throw bad('El carrito repite una misma selección de producto y opciones.');
    seen.add(key);
    const total = (quantities.get(item.id) || 0) + item.quantity;
    if (total > 100) throw bad('Puedes comprar hasta 100 unidades de un mismo producto.');
    quantities.set(item.id, total);
    return item;
  }).sort((a, b) => a.id - b.id || lineKey(a).localeCompare(lineKey(b)));
}

export function quantityByProduct(items) {
  const result = new Map();
  for (const item of items) result.set(item.id, (result.get(item.id) || 0) + item.quantity);
  return result;
}

export function selectedOptions(product, item) {
  const result = {};
  for (const [field, optionsName] of [['color', 'colors'], ['aroma', 'aromas']]) {
    const options = product[optionsName] || [], value = item[field] || '';
    if (!options.length) {
      if (value) throw bad('El producto ' + product.name + ' no ofrece esa opción de ' + field + '.', 409);
      result[field] = '';
    } else {
      const match = options.find(option => fold(option) === fold(value));
      if (!match) throw bad('Selecciona un ' + field + ' disponible para ' + product.name + '. Revisa el producto.', 409);
      result[field] = match;
    }
  }
  const date = item.workshopDate || '';
  const time = item.workshopTime || '';
  if (product.category === 'Talleres') {
    if (!validWorkshopDate(date) || date < chileToday() || !(product.workshop_dates || []).includes(date)) {
      throw bad('Selecciona una fecha disponible para ' + product.name + '. Revisa el taller.', 409);
    }
    const times = product.workshop_times || [];
    if (times.length || time) {
      const match = times.find(option => fold(option) === fold(time));
      if (!match) throw bad('Selecciona un horario disponible para ' + product.name + '. Revisa el taller.', 409);
      result.workshopTime = match;
    }
  } else if (date || time) throw bad('Este producto no ofrece fechas ni horarios de taller.', 409);
  return { ...result, ...(date ? { workshopDate: date } : {}) };
}

export function publicProduct(product, admin = false) {
  const gallery = Array.isArray(product.image_gallery) ? product.image_gallery : [];
  const images = gallery.length ? gallery.map(image => image.url) : product.image_url ? [product.image_url] : [];
  const { image_gallery, image_public_id, reserved_stock, ...safe } = product;
  return { ...safe, stock: admin ? product.stock : product.stock - (reserved_stock || 0),
    colors: product.colors || [], aromas: product.aromas || [],
    workshop_times: product.category === 'Talleres' ? product.workshop_times || [] : [],
    workshop_dates: product.category === 'Talleres' ? (product.workshop_dates || []).filter(date => admin || date >= chileToday()) : [],
    images, image_url: images[0] || null };
}

export function galleryOrder(value, keptUrls, count) {
  const allowed = [...keptUrls, ...Array.from({ length: count }, (_, index) => 'new:' + index)];
  if (value === undefined) return allowed;
  let order = value;
  if (typeof order === 'string') {
    try { order = JSON.parse(order); } catch { throw bad('El orden de las fotografías no es válido.'); }
  }
  if (!Array.isArray(order) || order.length !== allowed.length || new Set(order).size !== order.length ||
    order.some(key => typeof key !== 'string' || !allowed.includes(key))) throw bad('Revisa el orden de las fotografías.');
  return order;
}

export function orderItemDescription(item) {
  const options = [item.selected_color && 'Color: ' + item.selected_color, item.selected_aroma && 'Aroma: ' + item.selected_aroma,
    item.selected_workshop_date && 'Fecha: ' + formatWorkshopDate(item.selected_workshop_date),
    item.selected_workshop_time && 'Horario: ' + item.selected_workshop_time].filter(Boolean);
  return item.product_name + (options.length ? ' (' + options.join(' · ') + ')' : '');
}
