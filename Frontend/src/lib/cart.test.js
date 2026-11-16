import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCart, addCartItem, setCartQuantity, subtractPurchased, productQuantity } from './cart.js';

const product={id:1,name:'Vela',price:25000,stock:5,colors:['Blanco','Beige'],aromas:['Vainilla','Lavanda']};

test('migra el carrito anterior y limita el total de todas las variantes al stock general',()=>{
  const old=restoreCart([{id:1,name:'Pieza',price:1000,stock:3,quantity:8}]);
  assert.equal(old[0].quantity,3);assert.equal(old[0].color,'');assert.ok(old[0].key);
  const rows=restoreCart([{...product,quantity:4,color:'Blanco',aroma:'Vainilla'},{...product,quantity:4,color:'Beige',aroma:'Lavanda'}]);
  assert.equal(productQuantity(rows,1),5);
  assert.deepEqual(rows.map(row=>row.quantity),[4,1]);
  assert.deepEqual(restoreCart({}),[]);
});

test('agrupa solo combinaciones iguales y permite editar o eliminar una sin alterar otra',()=>{
  let rows=addCartItem([],product,2,{color:'Blanco',aroma:'Vainilla'});
  rows=addCartItem(rows,product,1,{color:'Beige',aroma:'Lavanda'});
  assert.equal(rows.length,2);
  rows=addCartItem(rows,product,1,{color:'Blanco',aroma:'Vainilla'});
  assert.deepEqual(rows.map(row=>row.quantity),[3,1]);
  rows=setCartQuantity(rows,rows[1].key,10);
  assert.deepEqual(rows.map(row=>row.quantity),[3,2]);
  assert.equal(productQuantity(rows,1),5);
  assert.equal(addCartItem(rows,product,1,{color:'Beige',aroma:'Lavanda'}),rows);
  assert.deepEqual(addCartItem([],product,1,{color:'No existe',aroma:'Vainilla'}),[]);
});

test('al completar el pedido se descuentan exclusivamente las combinaciones compradas',()=>{
  let rows=addCartItem([],product,2,{color:'Blanco',aroma:'Vainilla'});
  rows=addCartItem(rows,product,2,{color:'Beige',aroma:'Lavanda'});
  const after=subtractPurchased(rows,[{product_id:1,quantity:1,selected_color:'Blanco',selected_aroma:'Vainilla'}]);
  assert.deepEqual(after.map(row=>row.quantity),[1,2]);
  const all=subtractPurchased(rows,[{product_id:1,quantity:1,selected_color:'Blanco',selected_aroma:'Vainilla'},{product_id:1,quantity:1,selected_color:'Blanco',selected_aroma:'Vainilla'}]);
  assert.equal(all.length,1);assert.equal(all[0].color,'Beige');
});
