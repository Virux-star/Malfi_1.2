import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFlowClient, signFlowParams } from '../services/flowClient.js';
import { flowUrlAllowed, flowOrderId } from '../services/flow.js';
import { paymentProviders, providerMode } from '../config/paymentProviders.js';
import { runtimeConfig } from '../config/runtime.js';

const flow={mode:'disabled',flowMode:'integration',flowApiKey:'qa-api-key',flowSecretKey:'qa-secret-key',flowPublicOrigin:'https://qa.example.test'};
test('Flow firma valores originales, ordenados, antes de codificarlos en URL',()=>{
  const params={token:'TOKEN CON Á',apiKey:'qa-api-key',s:'ignored'};
  const expected=createHmac('sha256','qa-secret-key').update('apiKeyqa-api-keytokenTOKEN CON Á','utf8').digest('hex');
  assert.equal(signFlowParams(params,'qa-secret-key'),expected);
});
test('Flow está deshabilitado por defecto y no desplaza Mercado Pago si faltan claves',()=>{
  const mp={mode:'disabled',mpMode:'production',mpAccessToken:'qa-token',mpWebhookSecret:'qa-secret',mpCollectorId:'123',mpPublicOrigin:'https://shop.example.test',production:true};
  assert.deepEqual(paymentProviders({...mp}).providers.map(p=>p.id),['mercadopago']);
  assert.deepEqual(paymentProviders({...mp,...flow,flowMode:'production',flowSecretKey:''}).providers.map(p=>p.id),['mercadopago']);
  assert.deepEqual(paymentProviders({...mp,...flow,flowMode:'production'}).providers.map(p=>p.id),['mercadopago','flow']);
  assert.deepEqual(paymentProviders({...mp,...flow,allowIntegration:true,emailMode:'test'}).providers.map(p=>p.id),['mercadopago']);
  assert.deepEqual(paymentProviders({...flow,production:true,allowIntegration:true,emailMode:'test'}).providers.map(p=>p.id),['flow']);
  assert.equal(providerMode(flow,'flow'),'integration');
  assert.equal(createFlowClient({...flow,flowMode:'disabled'}),null);
  assert.equal(createFlowClient({...flow,flowSecretKey:''}),null);
});
test('el entorno impide modos Flow desconocidos y producción accidental en desarrollo',()=>{
  const env={SESSION_SECRET:'qa-session-00000000000000000000000000'};
  assert.equal(runtimeConfig(env).flowMode,'disabled');
  assert.throws(()=>runtimeConfig({...env,FLOW_MODE:'sandbox'}),/FLOW_MODE/);
  assert.throws(()=>runtimeConfig({...env,FLOW_MODE:'production'}),/NODE_ENV=production/);
});
test('URLs Flow respetan ambiente y rechazan credenciales, puertos y dominios parecidos',()=>{
  assert.equal(flowUrlAllowed('https://sandbox.flow.cl/app/web/pay.php','integration'),true);
  assert.equal(flowUrlAllowed('https://www.flow.cl/app/web/pay.php','production'),true);
  for(const url of ['https://www.flow.cl/app/web/pay.php','https://sandbox.flow.cl.evil.test/','http://sandbox.flow.cl/','https://user:pass@sandbox.flow.cl/','https://sandbox.flow.cl:444/','https://sandbox.flow.cl/#x'])assert.equal(flowUrlAllowed(url,'integration'),false,url);
  assert.equal(flowOrderId(123456),'123456');
  for(const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'1e5'])assert.equal(flowOrderId(id),null);
});
test('el cliente Flow usa POST form-urlencoded y firma GET sin reintentar creaciones inciertas',async()=>{
  const calls=[];
  const client=createFlowClient(flow,{fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,status:200,json:async()=>({total:0,data:[]})};
  }});
  await client.createPayment({amount:50000,currency:'CLP',subject:'Velas de soja'});
  const post=calls[0],form=new URLSearchParams(post.options.body);
  assert.equal(post.url,'https://sandbox.flow.cl/api/payment/create');
  assert.equal(post.options.headers['Content-Type'],'application/x-www-form-urlencoded');
  assert.equal(form.get('s'),signFlowParams({amount:50000,currency:'CLP',subject:'Velas de soja',apiKey:'qa-api-key'},'qa-secret-key'));
  assert.ok(!post.options.body.includes('qa-secret-key'));
  await client.getStatus('qa-token-123456');
  const get=new URL(calls[1].url);
  assert.equal(get.pathname,'/api/payment/getStatus');assert.equal(get.searchParams.get('token'),'qa-token-123456');
  assert.equal(await client.checkCredentials(),true);
  assert.equal(new URL(calls[2].url).pathname,'/api/payment/getPayments');assert.equal(calls[2].options.method,'GET');
  let attempted=0;
  const broken=createFlowClient(flow,{fetchImpl:async()=>{attempted++;throw Error('URL contains a private key');}});
  await assert.rejects(()=>broken.createPayment({amount:1}),e=>e.flowDiagnostic==='NETWORK'&&!e.message.includes('private key'));
  assert.equal(attempted,1);
  const rejected=createFlowClient(flow,{fetchImpl:async()=>({ok:false,status:401,json:async()=>({code:1,message:'private-key'})})});
  await assert.rejects(()=>rejected.getStatus('qa-token'),e=>e.flowDiagnostic==='HTTP_401_CODE_1'&&!JSON.stringify(e).includes('private-key'));
  const unsafe=createFlowClient(flow,{fetchImpl:async()=>({ok:false,status:400,json:async()=>({code:'private-key',message:'private-key'})})});
  await assert.rejects(()=>unsafe.getStatus('qa-token'),e=>e.flowDiagnostic==='HTTP_400'&&!JSON.stringify(e).includes('private-key'));
  const parameter=createFlowClient(flow,{fetchImpl:async()=>({ok:false,status:400,json:async()=>({code:1620,message:'timeout invalid: private-key https://secret.example/secret'})})});
  await assert.rejects(()=>parameter.createPayment({amount:50000}),e=>e.flowDiagnostic==='HTTP_400_CODE_1620_FIELD_TIMEOUT'&&!JSON.stringify(e).includes('private-key')&&!JSON.stringify(e).includes('secret.example'));
});
