import { defaultStore, getStore, readiness } from '../services/store.js';
const regions=['Arica y Parinacota','Tarapacá','Antofagasta','Atacama','Coquimbo','Valparaíso','Metropolitana de Santiago',"Libertador General Bernardo O'Higgins",'Maule','Ñuble','Biobío','La Araucanía','Los Ríos','Los Lagos','Aysén','Magallanes y de la Antártica Chilena'];
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
export function validRut(value) {
  const text=String(value).replace(/[.\s]/g,'').toUpperCase();
  if(!/^\d{7,8}-[\dK]$/.test(text))return false;
  const [body,dv]=text.split('-');let sum=0,m=2;
  for(const c of [...body].reverse()){sum+=Number(c)*m;m=m===7?2:m+1;}
  const n=11-sum%11;return (n===11?'0':n===10?'K':String(n))===dv;
}
export function registerStoreRoutes(app,pool,requireAdmin,config) {
  app.get('/api/health',wrap(async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok'});}));
  app.get('/api/store',wrap(async(req,res)=>{
    const r=await readiness(pool,config);
    res.json({business:r.store,checkoutAvailable:r.ready,paymentMode:config.mode,paymentProviders:r.paymentProviders,regions});
  }));
  app.get('/api/shipping/destinations',wrap(async(req,res)=>{
    const rates=await pool.query('SELECT region,comuna,carrier,price_clp,delivery_days_min,delivery_days_max FROM shipping_rates_comunas WHERE active=TRUE AND price_clp IS NOT NULL AND verified_at IS NOT NULL ORDER BY region,comuna');
    res.json(rates.rows);
  }));
  app.get('/api/admin/readiness',requireAdmin,wrap(async(req,res)=>{
    const r=await readiness(pool,config);
    res.json({ready:r.ready,issues:r.issues,mode:r.mode,mpMode:config.mpMode||'disabled',providerIssues:r.providerIssues,emailMode:config.emailMode,cloudinaryConfigured:!!(process.env.CLOUDINARY_CLOUD_NAME&&process.env.CLOUDINARY_API_KEY&&process.env.CLOUDINARY_API_SECRET)});
  }));
  app.get('/api/admin/settings',requireAdmin,wrap(async(req,res)=>res.json(await getStore(pool))));
  app.put('/api/admin/settings',requireAdmin,wrap(async(req,res)=>{
    const value={...defaultStore};
    for(const [field,max] of Object.entries({legalName:200,rut:15,legalAddress:300,representative:150,email:254,phone:25,returnsInstructions:2000})){
      if(typeof req.body?.[field]!=='string'||req.body[field].trim().length>max)return res.status(400).json({error:'Revisa los datos del negocio.'});
      value[field]=req.body[field].trim();
    }
    if(!value.legalName||!validRut(value.rut)||!value.legalAddress||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)||!/^[+0-9\s()-]{8,25}$/.test(value.phone)||!value.returnsInstructions)return res.status(400).json({error:'Completa razón social, RUT válido, domicilio legal, correo, teléfono e instrucciones de devolución.'});
    const days=Number(req.body.preparationDays);
    if(!Number.isInteger(days)||days<0||days>30)return res.status(400).json({error:'La preparación debe tomar entre 0 y 30 días hábiles.'});
    value.preparationDays=days;
    value.policiesVersion=new Date().toISOString();
    await pool.query("INSERT INTO store_settings(key,value) VALUES('business',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",[value]);
    res.json({message:'Datos del negocio guardados.',business:value});
  }));
  app.get('/api/admin/shipping',requireAdmin,wrap(async(req,res)=>{
    res.json((await pool.query('SELECT * FROM shipping_rates_comunas ORDER BY region,comuna')).rows);
  }));
  app.post('/api/admin/shipping',requireAdmin,wrap(async(req,res)=>{
    const {region,carrier}=req.body||{};
    const comuna=typeof req.body?.comuna==='string'?req.body.comuna.trim():'';
    const price=Number(req.body?.price),min=Number(req.body?.daysMin),max=Number(req.body?.daysMax);
    const santiago=req.body?.santiagoCoverage===true;
    if(String(req.body?.price??'').trim()===''||!regions.includes(region)||!comuna||comuna.length>100||!['Paket','Blue Express'].includes(carrier)||!Number.isInteger(price)||price<0||price>1000000||!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>60||typeof req.body.active!=='boolean')return res.status(400).json({error:'Revisa destino, tarifa en pesos y plazo de 1 a 60 días hábiles.'});
    if((carrier==='Paket'&&(!santiago||region!=='Metropolitana de Santiago'))||(carrier==='Blue Express'&&santiago))return res.status(400).json({error:'Paket se utiliza para comunas con cobertura de Santiago confirmada. Fuera de esa cobertura selecciona Blue Express.'});
    if(req.body.confirmedRealRate!==true)return res.status(400).json({error:'Confirma que el precio y el plazo corresponden a tu tarifa real.'});
    const old=await pool.query('SELECT id FROM shipping_rates_comunas WHERE lower(trim(region))=lower($1) AND lower(trim(comuna))=lower($2)',[region,comuna]);
    if(old.rowCount)await pool.query('UPDATE shipping_rates_comunas SET carrier=$2,price_clp=$3,delivery_days_min=$4,delivery_days_max=$5,santiago_coverage=$6,active=$7,verified_at=now(),updated_at=now() WHERE id=$1',[old.rows[0].id,carrier,price,min,max,santiago,req.body.active]);
    else await pool.query('INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,delivery_days_min,delivery_days_max,santiago_coverage,active,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())',[region,comuna,carrier,price,min,max,santiago,req.body.active]);
    res.json({message:'Tarifa de despacho guardada.'});
  }));
}
