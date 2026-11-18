import { formatWorkshopDate } from '../lib/workshops';

import { useState } from "react";
import "./AdminOrders.css";
import AdminCommercePayment from "../components/AdminCommercePayment";
import "./AdminSettings.css";
import AdminWebpayReview from "../components/AdminWebpayReview";
import AdminWebpayRetry from "../components/AdminWebpayRetry";
import AdminPendingReservations
  from "../components/AdminPendingReservations";

import { API_URL } from "../lib/api";

const statusLabels = {
  pending_payment: "Pendiente de pago",
  preparing: "En preparación",
  shipped: "Enviado",
  ready_for_pickup: "Listo para retiro",
  delivered: "Entregado",
  cancelled: "Cancelado",

  pending: "Pendiente",
  paid: "Pagado",
  payment_review: "Pago recibido - revisar inventario",
  failed: "Fallido",
  refunded: "Reembolsado"
};

const formatPrice = (value) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(Number(value));

const formatDate = (value) =>
  new Date(value).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    dateStyle: "medium",
    timeStyle: "short"
  });


function getNextOrderAction(order) {
  if (!order) return null;

  // Cancelar pedidos todavía pendientes de pago
  if (
    order.status === "pending_payment" &&
    order.payment_status === "pending"
  ) {
    return {
      status: "cancelled",
      label: "Cancelar pedido"
    };
  }

  // No permitir preparación sin pago confirmado
  if (order.payment_status !== "paid") {
    return null;
  }

  if (order.delivery_method === "pickup") {
    return {
      pending_payment: {status: "preparing", label: "Marcar en preparación"},
      preparing: {status: "ready_for_pickup", label: "Marcar listo para retiro"},
      ready_for_pickup: {status: "delivered", label: "Marcar como retirado"}
    }[order.status] || null;
  }

  const actions = {
    pending_payment: {
      status: "preparing",
      label: "Marcar en preparación"
    },

    preparing: {
      status: "shipped",
      label: "Marcar como enviado"
    },

    shipped: {
      status: "delivered",
      label: "Marcar como entregado"
    }
  };

  return actions[order.status] || null;
}


function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);

  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);

  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [mpCheckoutUrl, setMpCheckoutUrl] = useState("");
  const [mpError, setMpError] = useState("");

  // Obtener pedidos desde Express
  async function loadOrders(nextOffset = 0) {
    setOffset(nextOffset);
    setLoading(true);
    setError("");
    setSelectedOrder(null);
    setHasLoaded(false);

    try {
      const response = await fetch(
        `${API_URL}/api/admin/orders?offset=${nextOffset}&search=${encodeURIComponent(search)}`,
        {
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudieron cargar los pedidos."
        );
      }

      setOrders(data);
      setHasLoaded(true);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Abrir un pedido específico
  async function loadOrderDetail(orderId) {
    setMpCheckoutUrl("");
    setMpError("");
    setDetailLoading(true);
    setDetailError("");
    setSelectedOrder(null);

    try {
      const response = await fetch(
        `${API_URL}/api/admin/orders/${encodeURIComponent(orderId)}`,
        {
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo consultar el pedido."
        );
      }

      setSelectedOrder(data);

    } catch (err) {
      setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeOrderStatus(nextStatus) {
    if (!selectedOrder || updatingStatus) return;

    const confirmed = window.confirm(
      `¿Confirmas cambiar el pedido #${selectedOrder.id} a "${selectedOrder.delivery_method === "pickup" && nextStatus === "delivered" ? "Retirado" : statusLabels[nextStatus]}"?`
    );

    if (!confirmed) return;

    setUpdatingStatus(true);
    setStatusMessage("");
    setStatusError("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/orders/${selectedOrder.id}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: nextStatus
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo actualizar el estado."
        );
      }

      setOrders((previousOrders) =>
        previousOrders.map((order) =>
          order.id === selectedOrder.id
            ? {
                ...order,
                status: data.order.status
              }
            : order
        )
      );

      setSelectedOrder((previous) =>
        previous
          ? {
              ...previous,
              status: data.order.status,
              payment_status: data.order.payment_status
            }
          : previous
      );

      setStatusMessage("Estado actualizado correctamente.");
    } catch (error) {
      setStatusError(error.message);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function prepareMercadoPagoTest() {
    if (!selectedOrder || mpLoading) return;

    setMpLoading(true);
    setMpError("");
    setMpCheckoutUrl("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/payments/mercadopago/test/${selectedOrder.id}`,
        {
          method: "POST",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo crear el checkout."
        );
      }

      setMpCheckoutUrl(data.checkoutUrl);
    } catch (error) {
      setMpError(error.message);
    } finally {
      setMpLoading(false);
    }
  }

  async function startWebpayTest() {
    if (!selectedOrder) return;

    try {
      const response = await fetch(
        `${API_URL}/api/admin/webpay/test/${selectedOrder.id}`,
        {
          method: "POST",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo iniciar Webpay."
        );
      }

      // Webpay requiere un formulario POST con token_ws.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.url;

      const tokenInput = document.createElement("input");
      tokenInput.type = "hidden";
      tokenInput.name = "token_ws";
      tokenInput.value = data.token;

      form.appendChild(tokenInput);
      document.body.appendChild(form);
      form.submit();

    } catch (error) {
      alert(error.message);
    }
  }

  const webpayParams = new URLSearchParams(
    window.location.search
  );

  const webpayResult = webpayParams.get("webpay");
  const webpayPedido = webpayParams.get("pedido");

  const webpayMessages = {
    paid: "Webpay terminó la confirmación. Revisa el estado del pedido.",
    interrupted: "El pago fue interrumpido o cancelado. Verifica el estado antes de reintentar.",
    not_authorized: "Transbank no autorizó el pago.",
    review: "La transacción necesita revisión. No vuelvas a cobrar este pedido todavía."
  };

  const webpayMessage = webpayMessages[webpayResult];

  return (
    <main className="orders-admin">
      {webpayMessage && (
        <div
          role="status"
          style={{
            padding: "16px",
            marginBottom: "20px",
            background: "#F5EFE6",
            border: "1px solid #D8C8B4",
            borderRadius: "8px",
            color: "#49382E"
          }}
        >
          <strong>Resultado de Webpay</strong>

          <p>{webpayMessage}</p>

          {webpayPedido && (
            <p>Pedido #{webpayPedido}</p>
          )}
        </div>
      )}

      <header className="orders-admin-header">
        <span>MALFI · ADMINISTRACIÓN</span>
        <h1>Gestión de pedidos</h1>
        <p>Consulta las compras realizadas en la tienda.</p>
      </header>

      {import.meta.env.DEV && <AdminPendingReservations />}

      <nav className="orders-admin-nav">
        <a href="/admin">Portada</a>
        <a href="/admin/productos">Productos</a>
        <a href="/admin/pedidos">Pedidos</a>
        <a href="/">Ver tienda</a>
      </nav>

      <div className="orders-admin-access" style={{ flexWrap: "wrap", gap: 12 }}>
        <label>Buscar cliente o pedido <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, correo o número" /></label>
        <button
          type="button"
          onClick={() => loadOrders(0)}
          disabled={loading}
        >
          {loading ? "Cargando..." : "Consultar pedidos"}
        </button>
      </div>

      {error && (
        <p className="orders-admin-error" role="alert">
          {error}
        </p>
      )}

      {hasLoaded && <div><button className="secondary-button" disabled={loading || offset === 0} onClick={() => loadOrders(Math.max(0, offset - 50))}>Anteriores</button><span>Página {Math.floor(offset / 50) + 1}</span><button className="secondary-button" disabled={loading || orders.length < 50} onClick={() => loadOrders(offset + 50)}>Siguientes</button></div>}
      {hasLoaded && (
        <div className="orders-admin-layout">

          {/* LISTA DE PEDIDOS */}
          <section className="orders-admin-list">
            <h2>Últimos pedidos</h2>

            <p className="orders-admin-count">
              {orders.length} pedidos encontrados
            </p>

            {orders.length === 0 && (
              <p>Todavía no hay pedidos registrados.</p>
            )}

            {orders.map((order) => (
              <button
                type="button"
                className="orders-admin-card"
                key={order.id}
                onClick={() => loadOrderDetail(order.id)}
              >
                <div className="orders-admin-card-top">
                  <strong>Pedido #{order.id}</strong>
                  <span>{formatPrice(order.total_clp)}</span>
                </div>

                <p>{order.customer_name}</p>

                <p>
                  {order.shipping_comuna} · {order.carrier}
                </p>

                <p>
                  {order.item_count} artículo(s)
                </p>

                <div className="orders-admin-card-bottom">
                  <small>{formatDate(order.created_at)}</small>
                  <span>
                    {statusLabels[order.payment_status] ||
                      order.payment_status}
                  </span>
                </div>
              </button>
            ))}
          </section>

          {/* DETALLE DEL PEDIDO */}
          <section className="orders-admin-detail">

            <h2>Detalle del pedido</h2>

            {detailLoading && (
              <p role="status">Cargando detalle...</p>
            )}

            {detailError && (
              <p role="alert" className="orders-admin-error">
                {detailError}
              </p>
            )}

            {!selectedOrder && !detailLoading && !detailError && (
              <p>Selecciona un pedido para ver sus datos.</p>
            )}

            {selectedOrder && (
              <div className="orders-admin-detail-content">

                <h3>Pedido #{selectedOrder.id}</h3>

                <p>
                  <strong>Fecha:</strong>{" "}
                  {formatDate(selectedOrder.created_at)}
                </p>

                <h4>Cliente</h4>

                <p>{selectedOrder.customer_name}</p>
                <p>{selectedOrder.customer_email}</p>
                <p>{selectedOrder.customer_phone}</p>

                <h4>{selectedOrder.delivery_method === "pickup" ? "Punto de retiro en tienda" : "Dirección de despacho"}</h4>

                <p>{selectedOrder.shipping_address}</p>
                <p>
                  {selectedOrder.shipping_comuna},{" "}
                  {selectedOrder.shipping_region}
                </p>

                {selectedOrder.shipping_reference && (
                  <p>
                    Referencia: {selectedOrder.shipping_reference}
                  </p>
                )}

                <p>
                  <strong>{selectedOrder.delivery_method === "pickup" ? "Modalidad:" : "Transportista:"}</strong>{" "}
                  {selectedOrder.carrier}
                </p>

                <h4>Productos</h4>

                {selectedOrder.items.map((item) => (
                  <div
                    key={item.id || JSON.stringify([item.product_id,item.selected_color,item.selected_aroma,item.selected_workshop_date,item.selected_workshop_time])}
                    className="orders-admin-product"
                  >
                    <div>
                      <strong>{item.product_name}</strong>
                      {item.selected_workshop_date && <p>Fecha: {formatWorkshopDate(item.selected_workshop_date)}</p>}
                      {item.selected_workshop_time && <p>Horario: {item.selected_workshop_time}</p>}
                      {(item.selected_color || item.selected_aroma) && <p>{[item.selected_color && ("Color: " + item.selected_color), item.selected_aroma && ("Aroma: " + item.selected_aroma)].filter(Boolean).join(" · ")}</p>}
                      <p>
                        {item.quantity} ×{" "}
                        {formatPrice(item.unit_price_clp)}
                      </p>
                    </div>

                    <strong>
                      {formatPrice(item.line_total_clp)}
                    </strong>
                  </div>
                ))}

                <h4>Resumen</h4>
                {Number(selectedOrder.discount_clp)>0 && <div className="orders-admin-total-row">
                  <span>Ahorro{selectedOrder.coupon_code && ' · Cupón ' + selectedOrder.coupon_code}</span>
                  <span>{formatPrice(selectedOrder.discount_clp)}</span></div>}

                <div className="orders-admin-total-row">
                  <span>Subtotal</span>
                  <span>
                    {formatPrice(selectedOrder.subtotal_clp)}
                  </span>
                </div>

                <div className="orders-admin-total-row">
                  <span>{selectedOrder.delivery_method === "pickup" ? "Retiro en tienda" : "Despacho"}</span>
                  <span>
                    {formatPrice(selectedOrder.shipping_clp)}
                  </span>
                </div>

                <div className="orders-admin-total-row">
                  <strong>Total</strong>
                  <strong>
                    {formatPrice(selectedOrder.total_clp)}
                  </strong>
                </div>

                <h4>Estados</h4>

                <p>
                  Pedido:{" "}
                  {selectedOrder.delivery_method === "pickup" && selectedOrder.status === "delivered" ? "Retirado" : statusLabels[selectedOrder.status] ||
                    selectedOrder.status}
                </p>

                <p>
                  Pago:{" "}
                  {statusLabels[selectedOrder.payment_status] ||
                    selectedOrder.payment_status}
                </p>

                <h4>Administrar pedido</h4>

                {getNextOrderAction(selectedOrder) ? (
                  <button
                    type="button"
                    className={
                      getNextOrderAction(selectedOrder).status === "cancelled"
                        ? "orders-admin-action cancel"
                        : "orders-admin-action"
                    }
                    disabled={updatingStatus}
                    onClick={() =>
                      changeOrderStatus(
                        getNextOrderAction(selectedOrder).status
                      )
                    }
                  >
                    {updatingStatus
                      ? "Actualizando..."
                      : getNextOrderAction(selectedOrder).label}
                  </button>
                ) : (
                  <p className="orders-admin-notice">
                    No hay cambios de estado disponibles para este pedido.
                  </p>
                )}

                {selectedOrder.payment_status !== "paid" &&
                  selectedOrder.status === "pending_payment" && (
                    <p className="orders-admin-notice">
                      Este pedido todavía no tiene un pago confirmado.
                      No debe prepararse ni enviarse.
                    </p>
                  )}

                {statusMessage && (
                  <p role="status" className="orders-admin-success">
                    {statusMessage}
                  </p>
                )}

                {statusError && (
                  <p role="alert" className="orders-admin-error">
                    {statusError}
                  </p>
                )}

                {import.meta.env.DEV && selectedOrder.status === "pending_payment" &&
                  selectedOrder.payment_status === "pending" && (
                    <div className="mp-test-section">
                      <h4>Mercado Pago · Pruebas</h4>

                      <p>
                        Genera un checkout de prueba para este pedido.
                        No confirma el pago ni modifica el inventario.
                      </p>

                      <button
                        type="button"
                        onClick={prepareMercadoPagoTest}
                        disabled={mpLoading}
                        className="mp-test-button"
                      >
                        {mpLoading
                          ? "Preparando..."
                          : "Preparar pago de prueba"}
                      </button>

                      {mpError && (
                        <p role="alert" className="orders-admin-error">
                          {mpError}
                        </p>
                      )}

                      {mpCheckoutUrl && (
                        <a
                          href={mpCheckoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mp-test-link"
                        >
                          Abrir Checkout de prueba
                        </a>
                      )}
                    </div>
                  )}

                {import.meta.env.DEV && selectedOrder.status === "pending_payment" &&
                  selectedOrder.payment_status === "pending" && (
                  <button
                    type="button"
                    onClick={startWebpayTest}
                    className="orders-admin-action"
                  >
                    Probar pago con Webpay Plus
                  </button>
                  )}

                <AdminCommercePayment key={`commerce-${selectedOrder.id}`} order={selectedOrder} />
                {import.meta.env.DEV && <AdminWebpayReview
                  key={`${selectedOrder.id}-review`}
                  orderId={selectedOrder.id}
                />}

                {import.meta.env.DEV && <AdminWebpayRetry
                  key={selectedOrder.id}
                  orderId={selectedOrder.id}
                />}

              </div>
            )}

          </section>
        </div>
      )}

    </main>
  );
}

export default AdminOrders;
