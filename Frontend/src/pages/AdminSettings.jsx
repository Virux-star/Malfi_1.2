import { useEffect, useState } from 'react';
import { api, clp } from '../lib/api';
import { useStore } from '../context/StoreContext';
import './AdminSettings.css';
const empty={region:'Valparaíso',price:'',daysMin:'',daysMax:'',active:true,confirmedRealRate:false};
export default function AdminSettings(){
  const {store}=useStore();
  const [business,setBusiness]=useState(null),[shipping,setShipping]=useState(null),[ready,setReady]=useState(null);
  const [rate,setRate]=useState({...empty}),[paket,setPaket]=useState({active:false,daysMin:'',daysMax:'',confirmedRealRate:false});
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function reload(){
    const values=await Promise.all([api('/api/admin/settings'),api('/api/admin/shipping/settings'),api('/api/admin/readiness')]);
    setBusiness(values[0]);setShipping(values[1]);setReady(values[2]);
    setPaket({...values[1].paket,confirmedRealRate:false});
  }
  useEffect(()=>{reload().catch(e=>setError(e.message));},[]);
  async function save(e,regional){
    e.preventDefault();setBusy(true);setMessage('');setError('');
    try{
      const body=regional?{...rate,rateScope:'region',carrier:'Blue Express',santiagoCoverage:false}:business;
      const result=await api(regional?'/api/admin/shipping':'/api/admin/settings',{method:regional?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      setMessage(result.message);if(regional)setRate({...empty});await reload();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function savePaket(e){
    e.preventDefault();setBusy(true);setMessage('');setError('');
    try{
      const result=await api('/api/admin/shipping/paket',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(paket)});
      setMessage(result.message);await reload();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function edit(region){
    const r=shipping?.regional.find(r=>r.region===region);
    setRate(r?{region:r.region,price:r.price_clp??'',daysMin:r.delivery_days_min??'',daysMax:r.delivery_days_max??'',active:r.active,confirmedRealRate:false}:{...empty,region});
    document.getElementById('shipping-form').scrollIntoView({behavior:'smooth'});
  }
  return <main className="content-page admin-settings"><span className="eyebrow">MALFI · ADMINISTRACIÓN</span><h1>Preparar la tienda</h1>
    {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
    {ready&&<section className="admin-panel"><h2>{ready.ready?'Checkout habilitado':'Configuración pendiente'}</h2><p>Mercado Pago: {ready.mpMode||'disabled'} · Flow: {ready.flowMode||'disabled'} · Correo: {ready.emailMode} · Fotografías: {ready.cloudinaryConfigured?'configuradas':'configura Cloudinary'}</p>{ready.issues.length>0&&<ul>{ready.issues.map(i=><li key={i}>{i}</li>)}</ul>}{ready.providerIssues?.length>0&&<div className="notice"><strong>Configuración de medios de pago</strong><ul>{ready.providerIssues.map(i=><li key={i}>{i}</li>)}</ul></div>}<p className="muted">Las variables de entorno se configuran en el alojamiento. Esta pantalla nunca muestra las claves secretas.</p></section>}
    {business&&<section className="admin-panel"><h2>Datos del negocio y atención</h2><p>Estos datos se muestran en la tienda y se incluyen en la confirmación de compra.</p><form onSubmit={e=>save(e,false)} className="admin-form"><fieldset disabled={busy}>
      {Object.entries({legalName:'Nombre o razón social',rut:'RUT del negocio',legalAddress:'Domicilio legal',representative:'Representante legal (si corresponde)',email:'Correo de atención',phone:'Teléfono de atención'}).map(([name,label])=><label key={name}>{label}<input name={name} type={name==='email'?'email':'text'} maxLength={name==='legalAddress'?300:name==='legalName'?200:name==='rut'?15:name==='phone'?25:254} value={business[name]} required={name!=='representative'} onChange={e=>setBusiness({...business,[name]:e.target.value})}/></label>)}
      <label>Días hábiles de preparación<input type="number" min="0" max="30" required value={business.preparationDays} onChange={e=>setBusiness({...business,preparationDays:Number(e.target.value)})}/></label>
      <label>Cómo solicitar cambios, retracto o garantía<textarea required rows="4" maxLength={2000} value={business.returnsInstructions} onChange={e=>setBusiness({...business,returnsInstructions:e.target.value})}/></label>
      <button className="primary-button" disabled={busy}>Guardar datos del negocio</button></fieldset></form></section>}
    <section className="admin-panel"><h2>Paket · Santiago</h2>
      <p><strong>Tarifa única: {clp(shipping?.paket.price??3000)}</strong> para Santiago urbano, independiente de la comuna. Configura el plazo y la disponibilidad una sola vez. Origen: Las Condes.</p>
      {shipping&&<details><summary>Ver las {shipping.paket.comunas.length} comunas de Santiago</summary><p>{shipping.paket.comunas.join(', ')}.</p></details>}
      <form className="admin-form" onSubmit={savePaket}><fieldset disabled={busy||!shipping}>
        <div className="admin-columns">
          <label>Traslado mínimo de Paket (días hábiles)<input type="number" min="1" max="60" required value={paket.daysMin} onChange={e=>setPaket({...paket,daysMin:e.target.value})}/></label>
          <label>Traslado máximo de Paket (días hábiles)<input type="number" min={paket.daysMin||1} max="60" required value={paket.daysMax} onChange={e=>setPaket({...paket,daysMax:e.target.value})}/></label>
        </div>
        <p>El plazo de traslado se suma a los días de preparación del negocio.</p>
        <label className="inline-check"><input type="checkbox" checked={paket.active} onChange={e=>setPaket({...paket,active:e.target.checked})}/>Habilitar Paket para Santiago</label>
        <label className="inline-check"><input type="checkbox" required checked={paket.confirmedRealRate} onChange={e=>setPaket({...paket,confirmedRealRate:e.target.checked})}/>Confirmo la tarifa de $3.000, la cobertura de Santiago y el plazo acordado con Paket</label>
        <button className="primary-button" disabled={busy||!shipping}>Guardar Paket</button>
      </fieldset></form>
    </section>
    <section className="admin-panel"><h2>Blue Express · Tarifas por región</h2>
      <p>Ingresa un precio por región, sin agregar tarifas por comuna. Ese precio se aplicará a sus destinos habilitados. En la Región Metropolitana, las comunas de Santiago usan Paket y los demás destinos usan la tarifa regional de Blue Express.</p>
      <p>Confirma con Blue Express el valor, la cobertura y los plazos para los productos que vendes. No calculamos una tarifa automática del transportista.</p>
      <form id="shipping-form" className="admin-form" onSubmit={e=>save(e,true)}><fieldset disabled={busy||!shipping}>
        <label>Región de Blue Express<select value={rate.region} onChange={e=>edit(e.target.value)}>{(store?.regions||[]).map(r=><option key={r}>{r}</option>)}</select></label>
        <div className="admin-columns">
          <label>Precio regional del despacho (CLP)<input type="number" min="0" max="1000000" step="1" required value={rate.price} onChange={e=>setRate({...rate,price:e.target.value})}/></label>
          <label>Traslado mínimo (días hábiles)<input type="number" min="1" max="60" required value={rate.daysMin} onChange={e=>setRate({...rate,daysMin:e.target.value})}/></label>
          <label>Traslado máximo (días hábiles)<input type="number" min={rate.daysMin||1} max="60" required value={rate.daysMax} onChange={e=>setRate({...rate,daysMax:e.target.value})}/></label>
        </div>
        <label className="inline-check"><input type="checkbox" checked={rate.active} onChange={e=>setRate({...rate,active:e.target.checked})}/>Habilitar Blue Express en esta región</label>
        <label className="inline-check"><input type="checkbox" required checked={rate.confirmedRealRate} onChange={e=>setRate({...rate,confirmedRealRate:e.target.checked})}/>Confirmo el precio, la cobertura regional y el plazo con Blue Express</label>
        <button className="primary-button" disabled={busy||!shipping}>Guardar tarifa regional</button>
        <button className="secondary-button" type="button" onClick={()=>setRate({...empty})}>Limpiar formulario</button>
      </fieldset></form>
      <div className="table-scroll"><table><thead><tr><th>Región</th><th>Tarifa Blue Express</th><th>Traslado</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{(store?.regions||[]).map(region=>{
        const r=shipping?.regional.find(r=>r.region===region);
        return <tr key={region}><td>{region}{region==='Metropolitana de Santiago'&&<small>Destinos fuera de Santiago urbano</small>}</td><td>{r?clp(r.price_clp):'Sin definir'}</td><td>{r?`${r.delivery_days_min}–${r.delivery_days_max} días`:'Sin definir'}</td><td>{r?.active&&r?.verified_at?'Activo':'Sin habilitar'}</td><td><button type="button" onClick={()=>edit(region)}>{r?'Editar':'Agregar'}</button></td></tr>;
      })}</tbody></table></div>
      {!!shipping?.legacy.filter(r=>!shipping.regional.some(regional=>regional.region===r.region)).length&&<details><summary>Tarifas anteriores por comuna</summary><p>Se conservan hasta que guardes una tarifa regional de Blue Express. Al guardarla, el precio regional se aplicará a todas las comunas habilitadas de esa región.</p><ul>{shipping.legacy.filter(r=>!shipping.regional.some(regional=>regional.region===r.region)).map(r=><li key={r.id}>{r.region} · {r.comuna}: {clp(r.price_clp)}</li>)}</ul></details>}
    </section>
  </main>;
}
