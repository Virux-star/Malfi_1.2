import { defaultStore, getStore, readiness } from '../services/store.js';
import { pickupLocation, shippingPolicy } from '../config/fulfillment.js';
import { regions, destination, isPaketDestination, paketCommunes, paketPrice, santiagoRegion } from '../config/shipping.js';
import { shippingRates, shippingDestinations } from '../services/shipping.js';
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
    res.json({business:r.store,pickup:pickupLocation,shippingPolicy,checkoutAvailable:r.ready,paymentMode:config.mode,paymentProviders:r.paymentProviders,regions});
  }));
  app.get('/api/shipping/destinations',wrap(async(req,res)=>{
    res.json(await shippingDestinations(pool));
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
  app.get('/api/admin/shipping/settings',requireAdmin,wrap(async(req,res)=>{
    const rates=await shippingRates(pool);
    const paket=rates.filter(r=>r.carrier==='Paket'&&isPaketDestination(r.region,r.comuna));
    const verified=paket.filter(r=>r.active&&r.verified_at&&r.delivery_days_min>=1&&r.delivery_days_max>=r.delivery_days_min);
    res.json({paket:{price:paketPrice,comunas:paketCommunes,active:verified.length>0,
      daysMin:verified.length?Math.max(...verified.map(r=>r.delivery_days_min)):'',
      daysMax:verified.length?Math.max(...verified.map(r=>r.delivery_days_max)):''},
      regional:rates.filter(r=>r.rate_scope==='region'),
      legacy:rates.filter(r=>r.carrier==='Blue Express'&&r.rate_scope!=='region')});
  }));
  app.put('/api/admin/shipping/paket',requireAdmin,wrap(async(req,res)=>{
    const min=Number(req.body?.daysMin),max=Number(req.body?.daysMax);
    if(typeof req.body?.active!=='boolean'||!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>60)
      return res.status(400).json({error:'Revisa el plazo de Paket: entre 1 y 60 días hábiles.'});
    if(req.body.confirmedRealRate!==true)return res.status(400).json({error:'Confirma la tarifa de $3.000, cobertura de Santiago y plazo de Paket.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(20261116,7000)');
      for(const comuna of paketCommunes)await client.query(`INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,delivery_days_min,delivery_days_max,santiago_coverage,active,verified_at,rate_scope)
        VALUES($1,$2,'Paket',$3,$4,$5,TRUE,$6,now(),'comuna')
        ON CONFLICT(lower(trim(region)),lower(trim(comuna))) DO UPDATE SET carrier='Paket',price_clp=excluded.price_clp,
          delivery_days_min=excluded.delivery_days_min,delivery_days_max=excluded.delivery_days_max,santiago_coverage=TRUE,
          active=excluded.active,verified_at=now(),rate_scope='comuna',updated_at=now()`,[santiagoRegion,comuna,paketPrice,min,max,req.body.active]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    res.json({message:'Paket guardado: $3.000 para Santiago.'});
  }));
  app.post('/api/admin/shipping',requireAdmin,wrap(async(req,res)=>{
    const {region,carrier}=req.body||{};
    const regional=req.body?.rateScope==='region';
    const comuna=regional?'':typeof req.body?.comuna==='string'?req.body.comuna.trim():'';
    const place=regional&&regions.includes(region)?{region,comuna:''}:destination(region,comuna);
    const price=Number(req.body?.price),min=Number(req.body?.daysMin),max=Number(req.body?.daysMax);
    const santiago=req.body?.santiagoCoverage===true;
    if(String(req.body?.price??'').trim()===''||!place||!['Paket','Blue Express'].includes(carrier)||!Number.isInteger(price)||price<0||price>1000000||!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>60||typeof req.body.active!=='boolean')return res.status(400).json({error:'Revisa destino, tarifa en pesos y plazo de 1 a 60 días hábiles.'});
    if((regional&&carrier!=='Blue Express')||(carrier==='Paket'&&(!santiago||!isPaketDestination(place.region,place.comuna)||price!==paketPrice))||(carrier==='Blue Express'&&(santiago||(!regional&&isPaketDestination(place.region,place.comuna)))))return res.status(400).json({error:'Paket cuesta $3.000 en Santiago. Blue Express utiliza tarifas regionales para los demás destinos.'});
    if(req.body.confirmedRealRate!==true)return res.status(400).json({error:'Confirma que el precio, la cobertura y el plazo corresponden a tu acuerdo real.'});
    await pool.query(`INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,delivery_days_min,delivery_days_max,santiago_coverage,active,verified_at,rate_scope)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
      ON CONFLICT(lower(trim(region)),lower(trim(comuna))) DO UPDATE SET carrier=excluded.carrier,price_clp=excluded.price_clp,
        delivery_days_min=excluded.delivery_days_min,delivery_days_max=excluded.delivery_days_max,santiago_coverage=excluded.santiago_coverage,
        active=excluded.active,verified_at=now(),rate_scope=excluded.rate_scope,updated_at=now()`,
      [place.region,place.comuna,carrier,price,min,max,santiago,req.body.active,regional?'region':'comuna']);
    res.json({message:regional?'Tarifa regional de Blue Express guardada.':'Tarifa de despacho guardada.'});
  }));
}
