const fail = message => Object.assign(new Error(message), { status: 400 });

export function chileToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validWorkshopDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '9999-12-31') return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function workshopDateList(value) {
  let dates = value ?? [];
  if (typeof dates === 'string') {
    try { dates = JSON.parse(dates); } catch { throw fail('Revisa las fechas del taller.'); }
  }
  if (!Array.isArray(dates) || dates.length > 20 || dates.some(date => !validWorkshopDate(date))) {
    throw fail('Agrega hasta 20 fechas válidas para el taller.');
  }
  return [...new Set(dates)].sort();
}

export function formatWorkshopDate(value) {
  if (!validWorkshopDate(value)) return '';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(value + 'T12:00:00Z'));
}
