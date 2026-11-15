import test from 'node:test';
import assert from 'node:assert/strict';
import { bankApproved, validBank, paymentUrlAllowed } from '../services/payments.js';
import { validRut } from '../routes/store.js';
const a={buy_order:'M123',session_id:'s123',amount_clp:12000};
const bank={status:'AUTHORIZED',response_code:0,buy_order:'M123',session_id:'s123',amount:12000};
test('solo una autorización exacta permite confirmar una compra',()=>{
  assert.equal(bankApproved(bank,a),true);
  for(const change of [{response_code:null},{response_code:'0'},{response_code:-1},{status:'INITIALIZED'},{amount:12001},{buy_order:'M124'},{session_id:'otro'}])assert.equal(bankApproved({...bank,...change},a),false);
  assert.equal(validBank({...bank,amount:'12000'},a),true);
});
test('el formulario de pago solo permite el dominio del ambiente correspondiente',()=>{
  assert.equal(paymentUrlAllowed('https://webpay3g.transbank.cl/webpayserver/initTransaction','production'),true);
  for(const u of ['http://webpay3g.transbank.cl/','https://webpay3g.transbank.cl.evil.example/','https://user@webpay3g.transbank.cl/','https://webpay3gint.transbank.cl/','javascript:alert(1)'])assert.equal(paymentUrlAllowed(u,'production'),false);
});
test('el RUT del negocio se valida antes de publicarlo',()=>{
  assert.equal(validRut('76.123.456-0'),true);
  assert.equal(validRut('76.123.456-1'),false);
});
