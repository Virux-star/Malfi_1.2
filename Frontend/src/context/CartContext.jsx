import { clearSavedCoupon } from '../lib/useCartQuote';
import { restoreCart, addCartItem, setCartQuantity, subtractPurchased } from '../lib/cart';

import { createContext, useContext, useEffect, useState, useRef } from "react";

const CartContext = createContext(null);

const STORAGE_KEY = "malfi_cart";

function loadCart() {
  try { return restoreCart(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { return []; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);
  const completedOrders = useRef(new Set());

  // Guardar el carrito en el navegador
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* Cart still works when storage is blocked. */ }
  }, [items]);

  function addToCart(product, quantity = 1, options = {}) {
    setItems(previous => addCartItem(previous, product, quantity, options));
  }
  function updateQuantity(key, quantity) {
    setItems(previous => setCartQuantity(previous, key, quantity));
  }
  function removeFromCart(key) {
    setItems(previous => previous.filter(item => item.key !== key));
  }

  // Vaciar carrito
  function clearCart() {
    clearSavedCoupon();
    setItems([]);
  }

  function completeOrder(orderId, purchased) {
    const key = `malfi_completed_${orderId}`;
    if (completedOrders.current.has(String(orderId))) return;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
      const attempt = JSON.parse(localStorage.getItem("malfi_checkout_attempt") || "null");
      if (String(attempt?.orderId) === String(orderId)) localStorage.removeItem("malfi_checkout_attempt");
    } catch { /* The in-memory guard still handles browsers with blocked storage. */ }
    clearSavedCoupon();
    completedOrders.current.add(String(orderId));
    setItems(old => subtractPurchased(old, purchased));
  }

  // Cantidad total de artículos
  const cartCount = items.reduce(
    (total, item) => total + item.quantity,
    0
  );

  // Subtotal
  const subtotal = items.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        completeOrder,
        cartCount,
        subtotal
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart debe utilizarse dentro de CartProvider");
  }

  return context;
}
