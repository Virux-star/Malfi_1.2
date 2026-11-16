
import { useCart } from "../context/CartContext";
import "./CartPage.css";

function CartPage() {
  const {
    items,
    updateQuantity,
    removeFromCart,
    subtotal
  } = useCart();

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
                <article className="cart-item" key={item.id}>

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

                    <p className="cart-unit-price">
                      {formatPrice(item.price)}
                    </p>

                    <div className="cart-quantity">

                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.id,
                            item.quantity - 1
                          )
                        }
                        disabled={item.quantity <= 1}
                        aria-label={`Quitar una unidad de ${item.name}`}
                      >
                        −
                      </button>

                      <span>{item.quantity}</span>

                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.id,
                            item.quantity + 1
                          )
                        }
                        disabled={item.quantity >= item.stock}
                        aria-label={`Agregar una unidad de ${item.name}`}
                      >
                        +
                      </button>

                    </div>

                    <button
                      type="button"
                      className="cart-remove"
                      onClick={() => removeFromCart(item.id)}
                    >
                      Eliminar
                    </button>

                  </div>

                  <p className="cart-item-total">
                    {formatPrice(item.price * item.quantity)}
                  </p>

                </article>
              ))}

            </div>

            {/* RESUMEN */}
            <aside className="cart-summary">

              <h2>Resumen de compra</h2>

              <div className="cart-summary-row">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>

              <div className="cart-summary-row">
                <span>Despacho</span>
                <span>Por calcular</span>
              </div>

              <div className="cart-summary-divider" />

              <div className="cart-summary-row cart-summary-total">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>

              <p className="cart-summary-note">
                El valor del despacho se calculará al
                ingresar la dirección de entrega.
              </p>

              <a href="/checkout" className="cart-checkout">
  Continuar con mis datos
</a>

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
