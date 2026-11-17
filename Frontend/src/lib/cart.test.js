import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCart, addCartItem, setCartQuantity, subtractPurchased, productQuantity } from './cart.js';
import { unitQuantity, chileToday } from './workshops.js';

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

test('conserva fechas diferentes del taller al recargar y descuenta solo los cupos comprados', () => {
  const first = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const second = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const workshop = { id: 2, name: 'Taller', category: 'Talleres', price: 25000, stock: 5, workshop_dates: [first, second] };
  assert.deepEqual(addCartItem([], workshop), []);
  assert.deepEqual(addCartItem([], workshop, 1, { workshopDate: '2001-01-01' }), []);
  let rows = addCartItem([], workshop, 2, { workshopDate: first });
  rows = addCartItem(rows, workshop, 3, { workshopDate: second });
  assert.equal(rows.length, 2);
  assert.equal(productQuantity(rows, 2), 5);
  assert.deepEqual(restoreCart(JSON.parse(JSON.stringify(rows))), rows);
  const after = subtractPurchased(rows, [{ product_id: 2, quantity: 1, selected_workshop_date: second }]);
  assert.deepEqual(after.map(row => row.quantity), [2, 2]);
  assert.deepEqual(after.map(row => row.workshopDate), [first, second]);
  assert.equal(chileToday(new Date('2026-11-18T01:00:00Z')), '2026-11-17');
});

test('la cantidad de insumos es entera, positiva y limitada por el stock compartido', () => {
  const supply = { id: 3, name: 'Mechas', category: 'Insumos', price: 500, stock: 12 };
  let rows = addCartItem([], supply, unitQuantity(7, supply.stock));
  assert.equal(rows[0].quantity, 7);
  assert.equal(rows[0].price * rows[0].quantity, 3500);
  rows = setCartQuantity(rows, rows[0].key, 50);
  assert.equal(rows[0].quantity, 12);
  assert.equal(unitQuantity(-2, 12), 1);
  assert.equal(unitQuantity('', 12), 1);
  assert.equal(unitQuantity(3.8, 12), 3);
  assert.deepEqual(addCartItem([], supply, 1, { workshopDate: '2099-01-01' }), []);
});
