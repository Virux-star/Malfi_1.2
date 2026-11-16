import communes from '../data/chileComunas.json' with { type: 'json' };

// Geography: https://www.bcn.cl/siit/mapoteca/comunas (16 regions, 346 communes).
export const communesByRegion = communes;
export const regions = Object.keys(communes);
export const santiagoRegion = 'Metropolitana de Santiago';
export const paketPrice = 3000;
// Paket Santiago Urbano. Rural RM destinations use the regional Blue Express rate.
// Source: https://paketex.com/wp-content/uploads/2025/03/Terminos-y-Condiciones.pdf
export const paketCommunes = [
  'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central',
  'Huechuraba', 'Independencia', 'La Cisterna', 'La Florida', 'La Granja',
  'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo',
  'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda', 'Peñalolén',
  'Providencia', 'Pudahuel', 'Puente Alto', 'Quilicura', 'Quinta Normal',
  'Recoleta', 'Renca', 'San Bernardo', 'San Joaquín', 'San Miguel',
  'San Ramón', 'Santiago', 'Vitacura'
];
export const normalizePlace = value => String(value ?? '').normalize('NFD')
  .replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-CL');
export function destination(region, comuna) {
  const canonicalRegion = regions.find(r => normalizePlace(r) === normalizePlace(region));
  const canonicalCommune = communes[canonicalRegion]?.find(c => normalizePlace(c) === normalizePlace(comuna));
  return canonicalRegion && canonicalCommune ? { region: canonicalRegion, comuna: canonicalCommune } : null;
}
export function isPaketDestination(region, comuna) {
  return normalizePlace(region) === normalizePlace(santiagoRegion)
    && paketCommunes.some(c => normalizePlace(c) === normalizePlace(comuna));
}
