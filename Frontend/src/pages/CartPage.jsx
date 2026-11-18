import SelectedProductOptions from '../components/SelectedProductOptions';
import { formatWorkshopDate } from '../lib/workshops';
import QuantityInput from '../components/QuantityInput';
import { useState } from 'react';
import { useCartQuote } from '../lib/useCartQuote';
import SalePrice from '../components/SalePrice';
import { cartKey, productQuantity } from '../lib/cart';

import { useCart } from "../context/CartContext";
import { useStore } from "../context/StoreContext";
import "./CartPage.css";

function CartPage() {
  const {
    items,
    updateQuantity,
    removeFromCart
  } = useCart();
  const { store } = useStore();
  const freeFrom = store?.shippingPolicy?.freeFromClp;
  const { code, apply, quote, quoteError } = useCartQuote(items);
  const [input, setInput] = useState(code);
  const reviewed = new Map((quote?.items || []).map(row => [cartKey(row), row]));
  const freeShipping = quote?.freeShippingEligible;

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0
    }).format(price);

  return (
    <main className="cart-page">
      <div className="cart-container">

        <div className="cart-header">
          <h1>Tu carrito</h1>
          <p>Revisa los productos que has seleccionado.</p>
        </div>

        {items.length === 0 ? (
          <div className="empty-cart">
            <h2>Tu carrito está vacío</h2>

            <p>
              Descubre nuestras velas de soja
              y decoraciones artesanales.
            </p>

            <a href="/#tienda" className="cart-primary-link">
              Explorar colección
            </a>
          </div>
        ) : (
          <div className="cart-layout">

            {/* PRODUCTOS */}
            <div className="cart-items">

              {items.map((item) => (
                <article className="cart-item" key={item.key}>

                  <a
                    href={`/producto/${item.id}`}
                    className="cart-item-image"
                  >
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                      />
                    ) : (
                      <span>MALFI</span>
                    )}
                  </a>

                  <div className="cart-item-info">

                    <a href={`/producto/${item.id}`}>
                      <h2>{item.name}</h2>
                    </a>

                    <SelectedProductOptions item={item} />
                    {item.workshopDate && <p>Fecha: {formatWorkshopDate(item.workshopDate)}</p>}
                    {item.workshopTime && <p>Horario: {item.workshopTime}</p>}
                    <p className="cart-unit-price">
                      {reviewed.has(item.key) && <SalePrice price={reviewed.get(item.key).price} originalPrice={reviewed.get(item.key).originalPrice}/>}
                    </p>

                    <div className="cart-quantity">

                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.key,
                            item.quantity - 1
                          )
                        }
                        disabled={item.quantity <= 1}
                        aria-label={`Quitar una unidad de ${item.name}`}
                      >
                        −
                      </button>

                      <QuantityInput max={Math.max(1, item.stock - productQuantity(items, item.id) + item.quantity)}
                        aria-label={`Cantidad de ${item.name}${item.workshopDate ? ' para el ' + formatWorkshopDate(item.workshopDate) : ''}${item.workshopTime ? ' · ' + item.workshopTime : ''}`}
                        value={item.quantity} onChange={amount => updateQuantity(item.key, amount)} />

                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.key,
                            item.quantity + 1
                          )
                        }
                        disabled={productQuantity(items, item.id) >= item.stock}
                        aria-label={`Agregar una unidad de ${item.name}`}
                      >
                        +
                      </button>

                    </div>

                    <button
                      type="button"
                      className="cart-remove"
                      onClick={() => removeFromCart(item.key)}
                    >
                      Eliminar
                    </button>

                  </div>

                  <p className="cart-item-total">
                    {reviewed.has(item.key) && formatPrice(reviewed.get(item.key).line_total)}
                  </p>

                </article>
              ))}

            </div>

            {/* RESUMEN */}
            <aside className="cart-summary">

              <h2>Resumen de compra</h2>

              <form className="cart-coupon" onSubmit={e => { e.preventDefault(); apply(input); }}>
                <label htmlFor="cart-coupon-code">Cupón de descuento</label>
                <div><input id="cart-coupon-code" value={input} onChange={e => setInput(e.target.value)}
                  maxLength={32} autoCapitalize="characters" placeholder="Ingresa tu código"/>
                  <button disabled={!input.trim()} type="submit">Aplicar</button></div>
              </form>
              {code && <p className="coupon-feedback">{quote?.couponCode ? 'Cupón aplicado · ' + quote.couponCode : code}
                {' '}<button type="button" onClick={() => { setInput(''); apply(''); }}>Quitar cupón</button></p>}
              {quoteError && <p role="alert">{quoteError} <button type="button" onClick={() => apply(code)}>Reintentar</button></p>}
              {!quote && !quoteError && <p role="status">Calculando precios…</p>}
              {quote && <><div className="cart-summary-row">
                <span>Productos</span><strong>{formatPrice(quote.originalSubtotal)}</strong>
              </div>
              {quote.discount > 0 && <div className="cart-summary-row"><span>Descuento</span><strong>−{formatPrice(quote.discount)}</strong></div>}
              <div className="cart-summary-row">
                <span>Despacho</span><span>{freeShipping ? 'Gratis' : 'Por calcular'}</span>
              </div></>}

              <div className="cart-summary-divider" />

              <div className="cart-summary-row cart-summary-total">
                <span>Subtotal</span>
                <strong>{quote ? formatPrice(quote.subtotal) : '—'}</strong>
              </div>

              <p className="cart-summary-note">
                {freeShipping
                  ? 'Tu compra tiene despacho gratis en destinos habilitados. Confirmaremos los precios y la cobertura al continuar.'
                  : <>El valor del despacho se calculará al ingresar la dirección de entrega.{freeFrom != null && ` Despacho gratis desde ${formatPrice(freeFrom)} en productos.`}</>}
              </p>

              {quote ? <a href="/checkout" className="cart-checkout">Continuar con mis datos</a>
                : <button className="cart-checkout" disabled>Continuar con mis datos</button>}

              <a href="/#tienda" className="cart-continue">
                ← Seguir comprando
              </a>

            </aside>

          </div>
        )}

      </div>
    </main>
  );
}

export default CartPage;
