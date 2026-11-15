import test from 'node:test';
import assert from 'node:assert/strict';
import { mercadoPagoUrlAllowed, integerCLP, verifyMpSeller } from '../services/mercadoPago.js';
import { paymentProviders, publicHttpsOrigin } from '../config/paymentProviders.js';
import { createMercadoPagoClient } from '../services/mercadoPagoClient.js';
const mpConfig={mode:'integration',mpMode:'integration',mpAccessToken:'test-private-token',mpWebhookSecret:'test-signature-secret',mpCollectorId:'123456',mpPublicOrigin:'https://test.example.com'};
test('Mercado Pago exige un origen público HTTPS sin rutas ni credenciales',()=>{
  assert.equal(publicHttpsOrigin('https://local.example.com'),true);
  for(const value of ['http://test.example.com','https://localhost','https://127.0.0.1','https://[::1]','https://10.1.1.1','https://test.local','https://user:test@test.example.com','https://test.example.com/api'])assert.equal(publicHttpsOrigin(value),false,value);
});
test('la configuración incompleta de Mercado Pago conserva disponible Webpay',()=>{
  assert.deepEqual(paymentProviders({...mpConfig,mpWebhookSecret:''}).providers.map(p=>p.id),['webpay']);
  assert.deepEqual(paymentProviders(mpConfig).providers.map(p=>p.id),['webpay','mercadopago']);
  assert.deepEqual(paymentProviders({...mpConfig,mode:'disabled'}).providers.map(p=>p.id),['mercadopago']);
});
test('los montos CLP son enteros exactos y las URLs no aceptan dominios parecidos',()=>{
  for(const [value,expected] of [['15000.00',15000],['15000',15000],[15000,15000],['15000.50',null],['1e4',null],[-1,null],[null,null]])assert.equal(integerCLP(value),expected);
  assert.equal(mercadoPagoUrlAllowed('https://www.mercadopago.cl/checkout/v1/redirect?pref_id=abc','production'),true);
  for(const url of ['https://www.mercadopago.cl.evil.test/','http://www.mercadopago.cl/','https://evil@www.mercadopago.cl/','https://sandbox.mercadopago.com/'])assert.equal(mercadoPagoUrlAllowed(url,'production'),false);
});
test('una cuenta real no crea un checkout de integración, aunque el token empiece con APP_USR',async()=>{
  const client={getSeller:async()=>({id:123456,site_id:'MLC',tags:['normal']})};
  await assert.rejects(()=>verifyMpSeller(client,mpConfig));
  await assert.rejects(()=>verifyMpSeller({getSeller:async()=>({id:123456,site_id:'MLA',tags:['test_user']})},mpConfig));
  assert.equal((await verifyMpSeller({getSeller:async()=>({id:123456,site_id:'MLC',tags:['test_user']})},mpConfig)).id,123456);
});
test('el cliente REST mantiene el token fuera de la URL y no reintenta POST inciertos',async()=>{
  const calls=[];const client=createMercadoPagoClient(mpConfig,{fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({id:'pref123'})};}});
  await client.createPreference({items:[]});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.mercadopago.com/checkout/preferences');assert.equal(calls[0].opts.headers.Authorization,'Bearer test-private-token');assert.ok(!calls[0].url.includes('test-private-token'));
  let attempts=0;const broken=createMercadoPagoClient(mpConfig,{fetchImpl:async()=>{attempts++;throw new Error('timeout');}});
  await assert.rejects(()=>broken.createPreference({items:[]}));assert.equal(attempts,1);
});
