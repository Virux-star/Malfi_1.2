import { useEffect, useState } from 'react';
import { api, clp } from '../lib/api';
import { chileToday, formatWorkshopDate } from '../lib/workshops';
import './AdminPromotions.css';

const categoryNames = ['Velas de soja', 'Set de velas', 'Decoración de concreto', 'Talleres', 'Insumos'];
const displayCategory = value => value === 'Velas de soja' ? 'Velas' : value;
const emptyForm = () => ({
  kind: 'offer', name: '', code: '', percent: '', starts_on: chileToday(), ends_on: chileToday(),
  scope: 'category', category: 'Velas de soja', product_ids: [], min_subtotal: '', max_uses: ''
});
function status(rule) {
  if (!rule.enabled) return 'Pausada';
  if (rule.ends_on < chileToday()) return 'Finalizada';
  return rule.starts_on > chileToday() ? 'Programada' : 'Vigente';
}

export default function AdminPromotions() {
  const [rules, setRules] = useState([]), [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm), [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const coupon = form.kind === 'coupon';
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  async function load() {
    const [promos, catalog] = await Promise.all([api('/api/admin/promotions'), api('/api/admin/products')]);
    setRules(promos); setProducts(catalog); setLoaded(true);
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  function reset() { setEditId(null); setForm(emptyForm()); }
  function edit(rule) {
    setForm({ ...rule, code: rule.code || '', min_subtotal: rule.min_subtotal || '', max_uses: rule.max_uses ?? '',
      scope: rule.category ? 'category' : rule.product_ids.length ? 'products' : 'all' });
    setEditId(rule.id); setError(''); setNotice('');
    document.getElementById('promotion-editor')?.scrollIntoView({ block: 'start' });
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    if (form.scope === 'products' && !form.product_ids.length) { setError('Selecciona al menos un producto.'); return; }
    const body = { kind: form.kind, name: form.name, code: coupon ? form.code : null, percent: Number(form.percent),
      starts_on: form.starts_on, ends_on: form.ends_on, category: form.scope === 'category' ? form.category : null,
      product_ids: form.scope === 'products' ? form.product_ids : [], min_subtotal: coupon ? Number(form.min_subtotal) : 0,
      max_uses: coupon && form.max_uses ? Number(form.max_uses) : null };
    setBusy(true);
    try {
      const saved = await api('/api/admin/promotions' + (editId ? '/' + editId : ''), { method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setRules(prev => [{ ...saved, uses: prev.find(r => r.id === saved.id)?.uses || 0 }, ...prev.filter(r => r.id !== saved.id)]);
      setNotice(coupon ? 'Cupón guardado. Puedes compartir el código ' + saved.code + '.' : 'Oferta guardada.');
      reset();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function toggle(rule) {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api('/api/admin/promotions/' + rule.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }) });
      setRules(prev => prev.map(item => item.id === rule.id ? { ...item, ...saved } : item));
      setNotice(saved.enabled ? 'Promoción habilitada.' : 'Promoción pausada.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="promo-admin">
    <h1>Promociones</h1>
    <div className="promo-layout"><section id="promotion-editor">
      <h2>{editId ? 'Editar promoción' : 'Crear promoción'}</h2>
      <form onSubmit={save}><fieldset disabled={busy}>
        <label>Tipo<select value={form.kind} disabled={!!editId} onChange={e => set('kind', e.target.value)}>
          <option value="offer">Oferta automática</option><option value="coupon">Cupón de descuento</option></select></label>
        <label>Nombre<input required maxLength={100} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej. Especial de velas"/></label>
        {coupon && <label>Código para el carrito<input required pattern="[A-Za-z0-9_\-]{1,32}" maxLength={32} autoCapitalize="characters" value={form.code}
          onChange={e => set('code', e.target.value.toUpperCase())} placeholder="Ej. MALFI40"/></label>}
        <label>Descuento (%)<input required type="number" min="1" max="99" step="1" value={form.percent} onChange={e => set('percent', e.target.value)}/></label>
        <div className="promo-pair"><label>Fecha de inicio<input type="date" required value={form.starts_on} onChange={e => set('starts_on', e.target.value)}/></label>
        <label>Fecha de término<input type="date" required min={form.starts_on} value={form.ends_on} onChange={e => set('ends_on', e.target.value)}/></label></div>
        <small>Ambas fechas se incluyen, según la hora de Santiago.</small>
        <label>Aplicar a<select value={form.scope} onChange={e => setForm(prev => ({ ...prev, scope: e.target.value, category: prev.category || categoryNames[0] }))}>
          <option value="category">Una categoría</option><option value="products">Productos específicos</option><option value="all">Toda la tienda</option></select></label>
        {form.scope === 'category' && <label>Categoría<select value={form.category} onChange={e => set('category', e.target.value)}>
          {categoryNames.map(name => <option key={name} value={name}>{displayCategory(name)}</option>)}</select></label>}
        {form.scope === 'products' && <fieldset className="promo-products"><legend>Seleccionar productos</legend>
          {products.map(p => <label key={p.id}><input type="checkbox" checked={form.product_ids.includes(p.id)}
            onChange={e => set('product_ids', e.target.checked ? [...form.product_ids, p.id] : form.product_ids.filter(id => id !== p.id))}/>
            {p.name}{p.active ? '' : ' (oculto)'}</label>)}</fieldset>}
        {coupon && <div className="promo-pair"><label>Compra mínima (CLP)<input type="number" min="0" max="999999999" placeholder="Sin mínimo" value={form.min_subtotal} onChange={e => set('min_subtotal', e.target.value)}/></label>
          <label>Límite total de usos<input type="number" min="1" max="999999999" placeholder="Sin límite" value={form.max_uses} onChange={e => set('max_uses', e.target.value)}/></label></div>}
        <small>Cada producto recibe el mayor descuento disponible. El despacho se calcula después.</small>
        <div className="promo-actions"><button disabled={!loaded} type="submit">{busy ? 'Guardando…' : coupon ? 'Guardar cupón' : 'Guardar oferta'}</button>
          {editId && <button type="button" onClick={reset}>Cancelar edición</button>}</div>
      </fieldset></form>
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    </section>
    <section><h2>Promociones guardadas</h2>
      {!loaded ? <p>Cargando promociones…</p> : !rules.length ? <p>Aún no hay promociones.</p> : rules.map(rule =>
        <article key={rule.id}><div className="promo-head"><h3>{rule.name}</h3><span>{status(rule)}</span></div>
          <p><strong>{rule.percent} %</strong> · {rule.code ? 'Cupón ' + rule.code : 'Oferta automática'}</p>
          <p>{rule.category ? displayCategory(rule.category) : rule.product_ids.length ? products.filter(p => rule.product_ids.includes(p.id)).map(p => p.name).join(', ') : 'Toda la tienda'}</p>
          <p>{formatWorkshopDate(rule.starts_on)}{rule.starts_on !== rule.ends_on && ' al ' + formatWorkshopDate(rule.ends_on)}</p>
          {rule.min_subtotal > 0 && <p>Compra mínima {clp(rule.min_subtotal)}</p>}
          {rule.code && <p>Usos reservados o realizados · {rule.uses}{rule.max_uses && ' de ' + rule.max_uses}</p>}
          <div className="promo-actions"><button type="button" disabled={busy} onClick={() => edit(rule)}>Editar</button>
          <button type="button" disabled={busy} onClick={() => toggle(rule)}>{rule.enabled ? 'Pausar' : 'Habilitar'}</button></div>
        </article>)}
    </section></div>
  </main>;
}
