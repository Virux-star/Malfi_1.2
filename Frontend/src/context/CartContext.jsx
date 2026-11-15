
import { createContext, useContext, useEffect, useState, useRef } from "react";

const CartContext = createContext(null);

const STORAGE_KEY = "malfi_cart";

function loadCart() {
  try {
    const savedCart = localStorage.getItem(STORAGE_KEY);

    if (!savedCart) return [];

    const parsed = JSON.parse(savedCart);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item) =>
          Number.isInteger(item.id) &&
          typeof item.name === "string" &&
          Number.isInteger(item.price) &&
          item.price > 0 &&
          Number.isInteger(item.stock) &&
          item.stock > 0 &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0
      )
      .map((item) => ({
        ...item,
        quantity: Math.min(item.quantity, item.stock, 100)
      }));
  } catch (error) {
    console.error("Error al recuperar carrito:", error);
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);
  const completedOrders = useRef(new Set());

  // Guardar el carrito en el navegador
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* Cart still works when storage is blocked. */ }
  }, [items]);

  // Agregar productos
  function addToCart(product, quantity = 1) {
    const amount = Number(quantity);
    const available = Math.min(Number(product.stock), 100);

    if (
      !Number.isInteger(amount) ||
      amount <= 0 ||
      !Number.isInteger(available) ||
      available <= 0
    ) {
      return;
    }

    setItems((previousItems) => {
      const existing = previousItems.find(
        (item) => item.id === product.id
      );

      if (existing) {
        return previousItems.map((item) =>
          item.id === product.id
            ? {
                ...item,
                stock: available,
                quantity: Math.min(
                  item.quantity + amount,
                  available
                )
              }
            : item
        );
      }

      return [
        ...previousItems,
        {
          id: product.id,
          name: product.name,
          price: product.price,
          image_url: product.image_url,
          stock: available,
          quantity: Math.min(amount, available)
        }
      ];
    });
  }

  // Cambiar cantidad
  function updateQuantity(productId, quantity) {
    setItems((previousItems) =>
      previousItems.map((item) => {
        if (item.id !== productId) return item;

        return {
          ...item,
          quantity: Math.min(
            Math.max(1, Math.floor(Number(quantity)) || 1),
            item.stock
          )
        };
      })
    );
  }

  // Eliminar producto
  function removeFromCart(productId) {
    setItems((previousItems) =>
      previousItems.filter((item) => item.id !== productId)
    );
  }

  // Vaciar carrito
  function clearCart() {
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
    completedOrders.current.add(String(orderId));
    const quantities = new Map(purchased.map(i => [i.product_id, i.quantity]));
    setItems(old => old.map(i => ({ ...i, quantity: i.quantity - (quantities.get(i.id) || 0) })).filter(i => i.quantity > 0));
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
