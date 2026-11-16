import { communesByRegion, destination, isPaketDestination, normalizePlace, paketPrice } from '../config/shipping.js';
import { shippingPolicy } from '../config/fulfillment.js';

export const qualifiesForFreeShipping = subtotal => Number.isSafeInteger(subtotal) && subtotal >= shippingPolicy.freeFromClp;
export const shippingPrice = (subtotal, basePrice) => qualifiesForFreeShipping(subtotal) ? 0 : basePrice;

const usable = rate => rate?.active && rate.verified_at && Number.isInteger(rate.price_clp)
  && rate.price_clp >= 0 && Number.isInteger(rate.delivery_days_min)
  && rate.delivery_days_min >= 1 && Number.isInteger(rate.delivery_days_max)
  && rate.delivery_days_max >= rate.delivery_days_min;

export async function shippingRates(db, region, { lock = false } = {}) {
  return (await db.query(`SELECT * FROM shipping_rates_comunas
    ${region ? 'WHERE lower(trim(region)) = lower($1)' : ''}
    ORDER BY region,comuna ${lock ? 'FOR SHARE' : ''}`, region ? [region] : [])).rows;
}

export function rateForDestination(rates, region, comuna) {
  const place = destination(region, comuna);
  if (!place) return null;
  const matching = rates.filter(r => normalizePlace(r.region) === normalizePlace(place.region));
  const exact = matching.find(r => r.rate_scope !== 'region' && normalizePlace(r.comuna) === normalizePlace(place.comuna));
  let rate;
  if (isPaketDestination(place.region, place.comuna)) {
    // Never silently route Santiago to Blue Express when Paket is disabled.
    if (exact?.carrier === 'Paket') rate = exact;
  } else {
    // A saved regional rate, including a disabled one, supersedes legacy commune rates.
    rate = matching.find(r => r.rate_scope === 'region' && r.carrier === 'Blue Express');
    if (!rate && exact?.carrier === 'Blue Express') rate = exact;
  }
  if (!usable(rate)) return null;
  return { ...rate, ...place, price_clp: rate.carrier === 'Paket' ? paketPrice : rate.price_clp };
}

export async function resolveShipping(db, region, comuna, options) {
  const place = destination(region, comuna);
  if (!place) return null;
  return rateForDestination(await shippingRates(db, place.region, options), place.region, place.comuna);
}

export async function shippingDestinations(db) {
  const rates = await shippingRates(db);
  const result = [];
  for (const [region, communes] of Object.entries(communesByRegion)) {
    for (const comuna of communes) {
      const rate = rateForDestination(rates, region, comuna);
      if (rate) result.push({ region, comuna, carrier: rate.carrier, price_clp: rate.price_clp,
        delivery_days_min: rate.delivery_days_min, delivery_days_max: rate.delivery_days_max, rate_scope: rate.rate_scope });
    }
  }
  return result;
}
