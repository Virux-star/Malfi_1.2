import { useEffect, useState } from "react";
import "./ProductDetail.css";
import { useCart } from "../context/CartContext";

import { API_URL } from "../lib/api";

function ProductDetail({ productId }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [quantity, setQuantity] = useState(1);
const [cartMessage, setCartMessage] = useState("");

const { items, addToCart } = useCart();

function handleAddToCart() {
  if (!product || product.stock <= 0) return;

  const existingQuantity =
    items.find((item) => item.id === product.id)?.quantity || 0;

  const availableToAdd = product.stock - existingQuantity;

  if (availableToAdd <= 0) {
    setCartMessage(
      "Ya tienes todas las unidades disponibles en tu carrito."
    );
    return;
  }

  const amount = Math.min(quantity, availableToAdd);

  addToCart(product, amount);

  setCartMessage(
    `${amount} unidad(es) agregadas al carrito.`
  );
}

  useEffect(() => {
    const controller = new AbortController();

    async function loadProduct() {
      setLoading(true);
      setError("");
      setProduct(null);

      try {
        const response = await fetch(
          `${API_URL}/api/products/${productId}`,
          { signal: controller.signal }
        );

        if (response.status === 404) {
          throw new Error("Producto no encontrado");
        }

        if (!response.ok) {
          throw new Error("No se pudo cargar el producto");
        }

        const data = await response.json();
        setProduct(data);

      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProduct();

    return () => controller.abort();
  }, [productId]);

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0
    }).format(price);

  return (
    <main className="product-detail-page">
      <div className="product-detail-container">

        <a href="/#tienda" className="product-detail-back">
          ← Volver a la colección
        </a>

        {loading && (
          <p role="status">Cargando producto...</p>
        )}

        {!loading && error && (
          <p role="alert">{error}</p>
        )}

        {!loading && product && (
          <div className="product-detail-layout">

            <div className="product-detail-photo">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                />
              ) : (
                <div className="product-detail-placeholder">
                  MALFI
                </div>
              )}
            </div>

            <div className="product-detail-info">

              <span className="detail-category">
                {product.category}
              </span>

              <h1>{product.name}</h1>

              <p className="detail-price">
                {formatPrice(product.price)}
              </p>

              <div className="detail-divider" />

              <h2>Descripción</h2>

              <p className="detail-description">
                {product.description ||
                  "Sin descripción disponible."}
              </p>

              <div className="detail-divider" />

              <p className={
                product.stock > 0
                  ? "detail-stock available"
                  : "detail-stock unavailable"
              }>
                {product.stock > 0
                  ? `Disponible · ${product.stock} unidades`
                  : "Producto agotado"}
              </p>

              <p className="detail-shipping">
                Consulta los destinos y costos de despacho al finalizar tu compra.
              </p>

              {product.stock > 0 && (
  <div className="detail-cart-actions">

    <label htmlFor="product-quantity">
      Cantidad
    </label>

    <div className="quantity-selector">
      <button
        type="button"
        onClick={() =>
          setQuantity((previous) => Math.max(1, previous - 1))
        }
        disabled={quantity <= 1}
        aria-label="Disminuir cantidad"
      >
        −
      </button>

      <span id="product-quantity">{quantity}</span>

      <button
        type="button"
        onClick={() =>
          setQuantity((previous) =>
            Math.min(product.stock, previous + 1)
          )
        }
        disabled={quantity >= product.stock}
        aria-label="Aumentar cantidad"
      >
        +
      </button>
    </div>

    <button
      type="button"
      className="add-cart-button"
      onClick={handleAddToCart}
    >
      Agregar al carrito
    </button>

    <p role="status" className="cart-feedback">
      {cartMessage}
    </p>

    {cartMessage.includes("agregadas") && (
      <a href="/carrito" className="view-cart-link">
        Ver mi carrito
      </a>
    )}

  </div>
)}

              <a
                href="/#tienda"
                className="detail-shop-link"
              >
                Seguir explorando
              </a>

            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default ProductDetail;
