import SalePrice from '../components/SalePrice';
import { formatWorkshopDate, unitQuantity } from '../lib/workshops';
import QuantityInput from '../components/QuantityInput';
import { productQuantity, cartKey } from '../lib/cart';
import { useEffect, useState } from "react";
import "./ProductDetail.css";
import { useCart } from "../context/CartContext";

import { API_URL } from "../lib/api";

function ProductDetail({ productId }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [quantity, setQuantity] = useState(1);
  const [color, setColor] = useState("");
  const [aroma, setAroma] = useState("");
  const [workshopDate, setWorkshopDate] = useState("");
  const [workshopTime, setWorkshopTime] = useState("");
  const [photoIndex, setPhotoIndex] = useState(0);
const [cartMessage, setCartMessage] = useState("");

const { items, addToCart } = useCart();

function handleAddToCart() {
  if (!product || product.stock <= 0) return;

  if (!selectionReady) {
    setCartMessage("Selecciona las opciones de tu producto."); return;
  }
  const key = cartKey({ id: product.id, color, aroma, workshopDate, workshopTime });
  if (items.length >= 30 && !items.some(item => item.key === key)) {
    setCartMessage("El carrito admite hasta 30 selecciones distintas."); return;
  }
  const existingQuantity = productQuantity(items, product.id);

  const availableToAdd = Math.min(product.stock, 100) - existingQuantity;

  if (availableToAdd <= 0) {
    setCartMessage(
      "Ya tienes todas las unidades disponibles en tu carrito."
    );
    return;
  }

  const amount = unitQuantity(quantity, availableToAdd);

  addToCart(product, amount, { color, aroma, workshopDate, workshopTime });
  setQuantity(1);

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
      setColor(""); setAroma(""); setWorkshopDate(""); setWorkshopTime(""); setPhotoIndex(0); setQuantity(1); setCartMessage("");

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

  const photos = product?.images?.length ? product.images : product?.image_url ? [product.image_url] : [];
  const availableToAdd = product ? Math.max(0, Math.min(product.stock, 100) - productQuantity(items, product.id)) : 0;
  const isWorkshop = product?.category === "Talleres";
  const selectionReady = (!isWorkshop || !!product?.workshop_dates?.includes(workshopDate)) &&
    (!product?.workshop_times?.length || product.workshop_times.includes(workshopTime)) && (!product?.colors?.length || !!color) && (!product?.aromas?.length || !!aroma);

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

            <div className="product-gallery">
              <div className="product-detail-photo">
                {photos.length ? <img src={photos[photoIndex] || photos[0]} alt={product.name + ' · Fotografía ' + (photoIndex + 1)} /> : <div className="product-detail-placeholder">MALFI</div>}
              </div>
              {photos.length > 1 && <div className="product-gallery-thumbs" role="group" aria-label="Fotografías del producto">
                {photos.map((url, index) => <button type="button" key={url} aria-pressed={photoIndex === index} aria-label={'Ver fotografía ' + (index + 1)} onClick={() => setPhotoIndex(index)}>
                  <img src={url} alt="" loading="lazy" />
                </button>)}
              </div>}
            </div>

            <div className="product-detail-info">

              <span className="detail-category">
                {product.category}
              </span>

              <h1>{product.name}</h1>

              <p className="detail-price">
                <SalePrice price={product.price} originalPrice={product.originalPrice} percent={product.offerPercent}/>
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
                  ? `Disponible · ${product.stock} ${isWorkshop ? "cupos totales" : "unidades"}`
                  : "Producto agotado"}
              </p>

              <p className="detail-shipping">
                Consulta los destinos y costos de despacho al finalizar tu compra.
              </p>

              <div className="detail-options">
                {isWorkshop && <label>Fecha del taller
                  <select value={workshopDate} onChange={event => { setWorkshopDate(event.target.value); setCartMessage(''); }} disabled={!product.workshop_dates?.length}>
                    <option value="">Selecciona una fecha</option>
                    {(product.workshop_dates || []).map(date => <option key={date} value={date}>{formatWorkshopDate(date)}</option>)}
                  </select>
                </label>}
                {isWorkshop && product.workshop_times?.length > 0 && <label>Horario del taller
                  <select value={workshopTime} onChange={event => { setWorkshopTime(event.target.value); setCartMessage(''); }}>
                    <option value="">Selecciona un horario</option>
                    {product.workshop_times.map(time => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>}
                {isWorkshop && !product.workshop_dates?.length && <p role="status">Pronto publicaremos nuevas fechas para este taller.</p>}
                {product.colors?.length > 0 && <label>Color
                  <select value={color} onChange={event => { setColor(event.target.value); setCartMessage(''); }}>
                    <option value="">Selecciona un color</option>
                    {product.colors.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>}
                {product.aromas?.length > 0 && <label>Aroma
                  <select value={aroma} onChange={event => { setAroma(event.target.value); setCartMessage(''); }}>
                    <option value="">Selecciona un aroma</option>
                    {product.aromas.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>}
                {!selectionReady && <p>Selecciona las opciones antes de agregar al carrito.</p>}
              </div>

              {product.stock > 0 && (
  <div className="detail-cart-actions">

    <label htmlFor="product-quantity">
      {isWorkshop ? "Cantidad de cupos" : "Cantidad (unidades)"}
    </label>

    <div className="quantity-selector">
      <button
        type="button"
        onClick={() =>
          setQuantity((previous) => unitQuantity(Number(previous) - 1, availableToAdd))
        }
        disabled={quantity <= 1}
        aria-label="Disminuir cantidad"
      >
        −
      </button>

      <QuantityInput id="product-quantity" max={Math.max(1, availableToAdd)}
        value={quantity} onChange={setQuantity} disabled={availableToAdd <= 0} />

      <button
        type="button"
        onClick={() =>
          setQuantity((previous) =>
            unitQuantity(Number(previous) + 1, availableToAdd)
          )
        }
        disabled={quantity >= availableToAdd}
        aria-label="Aumentar cantidad"
      >
        +
      </button>
    </div>

    <button
      type="button"
      className="add-cart-button"
      disabled={!selectionReady || availableToAdd <= 0}
      onClick={handleAddToCart}
    >
      Agregar al carrito
    </button>

    {availableToAdd <= 0 && <p>Ya tienes todas las unidades disponibles en tu carrito.</p>}
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
