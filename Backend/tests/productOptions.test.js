import test from 'node:test';
import assert from 'node:assert/strict';
import { optionList, normalizeCartLines, quantityByProduct, selectedOptions, publicProduct, galleryOrder, orderItemDescription } from '../services/productOptions.js';
import { orderEmail } from '../services/commerceWorker.js';
import { compactOrderEmail } from '../services/compactOrderEmail.js';

test('colores y aromas se normalizan, deduplican y limitan sin aceptar estructuras arbitrarias', () => {
  assert.deepEqual(optionList('[" Blanco ","blanco","Beige"]'), ['Blanco','Beige']);
  assert.throws(() => optionList(['']));
  assert.throws(() => optionList(['x'.repeat(61)]));
  assert.throws(() => optionList(Array.from({length:21},(_,i)=>String(i))));
  assert.throws(() => optionList([{}]));
  assert.throws(() => optionList(['a\nb']));
  assert.throws(() => optionList('{"colors":[]}'));
});

test('un producto permite combinaciones distintas con stock general y bloquea duplicados o cantidades agregadas excesivas', () => {
  const items=normalizeCartLines([{id:2,quantity:2,color:'Beige',aroma:'Vainilla'},{id:2,quantity:3,color:'Blanco',aroma:'Lavanda'}]);
  assert.equal(quantityByProduct(items).get(2),5);
  assert.throws(() => normalizeCartLines([{id:2,quantity:1,color:'Blanco'},{id:2,quantity:1,color:' blanco '}]));
  assert.throws(() => normalizeCartLines([{id:2,quantity:60,color:'Blanco'},{id:2,quantity:50,color:'Beige'}]));
  assert.throws(() => normalizeCartLines([{id:2,quantity:1,color:{}}]));
  const product={name:'Vela',colors:['Blanco','Beige'],aromas:['Vainilla','Lavanda']};
  assert.deepEqual(selectedOptions(product,{color:'blanco',aroma:'vainilla'}),{color:'Blanco',aroma:'Vainilla'});
  assert.throws(() => selectedOptions(product,{color:'Azul',aroma:'Vainilla'}));
  assert.throws(() => selectedOptions(product,{color:'Blanco'}));
  assert.deepEqual(selectedOptions({name:'Pieza'},{}),{color:'',aroma:''});
  assert.throws(() => selectedOptions({name:'Pieza'},{aroma:'Lavanda'}));
});

test('el orden de fotografías solo admite fotos conservadas y nuevas de la propia solicitud', () => {
  assert.deepEqual(galleryOrder('["new:0","https://example.test/old"]',['https://example.test/old'],1),['new:0','https://example.test/old']);
  assert.throws(() => galleryOrder(['new:1'],[],1));
  assert.throws(() => galleryOrder(['new:0','new:0'],[],2));
  assert.throws(() => galleryOrder(['https://evil.test/foreign'],['https://example.test/old'],0));
  assert.throws(() => galleryOrder('{}',[],0));
});

test('la API pública conserva la imagen principal y nunca devuelve identificadores internos de Cloudinary', () => {
  const product={id:1,stock:10,reserved_stock:3,image_url:'old',image_public_id:'internal-secret',
    image_gallery:[{url:'https://example.test/main',public_id:'internal-secret'},{url:'https://example.test/extra',public_id:'another-internal'}]};
  const visible=publicProduct(product);
  assert.equal(visible.stock,7);
  assert.equal(publicProduct(product,true).stock,10);
  assert.deepEqual(visible.images,['https://example.test/main','https://example.test/extra']);
  assert.equal(visible.image_url,visible.images[0]);
  assert.equal(visible.image_gallery,undefined);
  assert.equal(visible.image_public_id,undefined);
  assert.equal(JSON.stringify(visible).includes('internal-secret'),false);
});

test('los correos del comprador y administración muestran las opciones guardadas y escapan HTML', () => {
  const item={product_name:'Vela',selected_color:'<img src=x>',selected_aroma:'Vainilla',quantity:1,unit_price_clp:25000,line_total_clp:25000};
  const order={id:1,customer_name:'QA',customer_email:'qa@example.test',customer_phone:'+56900000000',checkout_key:'qa-key',
    payment_mode:'integration',subtotal_clp:25000,shipping_clp:3000,total_clp:28000,carrier:'Paket',delivery_days_min:1,delivery_days_max:3,
    shipping_address:'Dirección QA',shipping_comuna:'Las Condes',shipping_region:'Metropolitana de Santiago',
    business_snapshot:{legalName:'QA',rut:'11.111.111-1',legalAddress:'Dirección QA',email:'store@example.test'}};
  const config={origin:'https://qa.example.test',secret:'qa-order-secret'};
  assert.match(orderItemDescription(item),/Aroma: Vainilla/);
  for(const kind of ['payment_confirmed','admin_new_order']) {
    const original=orderEmail(kind,order,[item],config);
    const email=compactOrderEmail(kind,order,[item],config,original.text);
    assert.match(email.text,/Color: <img src=x>/);
    assert.match(email.text,/Aroma: Vainilla/);
    assert.ok(email.html.includes('&lt;img src=x&gt;'));
    assert.ok(!email.html.includes('<img src=x>'));
  }
});
