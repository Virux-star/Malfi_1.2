
import { useEffect, useState } from "react";

import { API_URL as API } from "../lib/api";

export default function AdminPendingReservations() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function api(path, method = "GET") {
    const response = await fetch(`${API}${path}`, {
      method,
      credentials: "include",
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Error HTTP ${response.status}`
      );
    }

    return data;
  }

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      const data = await api(
        "/api/admin/orders/pending-reservations"
      );

      setOrders(data.orders || []);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function checkWebpay(orderId) {
    setCheckingId(orderId);
    setError("");
    setMessage("");

    try {
      const data = await api(
        `/api/admin/webpay/test/check-retry/${orderId}`,
        "POST"
      );

      setMessage(
        `Pedido #${orderId}: ${data.reason}`
      );

      await refresh();

    } catch (err) {
      setError(err.message);
    } finally {
      setCheckingId(null);
    }
  }

  function getDescription(order) {
    if (order.has_mercado_pago) {
      return "Requiere revisión con Mercado Pago";
    }

    if (!order.has_webpay) {
      return "Sin intento de pago registrado";
    }

    if (!order.attempt_no) {
      return "Historial Webpay sin intento actual";
    }

    if (order.last_bank_status === "AUTHORIZED") {
      return "Posible pago autorizado: conciliar";
    }

    if (order.last_bank_status === "FAILED") {
      return "Pago rechazado por Transbank";
    }

    if (order.last_bank_status === "INITIALIZED") {
      return "Pago iniciado sin autorización confirmada";
    }

    return "Pendiente de consulta bancaria";
  }

  return (
    <section className="admin-pending-reservations">
      <h2>Reservas pendientes de pago</h2>

      <p>
        Pedidos de más de 15 minutos que todavía
        mantienen productos reservados.
      </p>

      <button
        type="button"
        onClick={refresh}
        disabled={loading || checkingId !== null}
      >
        {loading ? "Actualizando..." : "Actualizar listado"}
      </button>

      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      {!loading && orders.length === 0 && !error && (
        <p>No hay reservas antiguas pendientes.</p>
      )}

      <div className="admin-pending-list">
        {orders.map(order => (
          <article
            key={order.order_id}
            className="admin-pending-card"
          >
            <h3>Pedido #{order.order_id}</h3>

            <p>
              Tiempo pendiente: {order.minutes_old} min
            </p>

            <p>
              Total: $
              {Number(order.total_clp).toLocaleString("es-CL")}
            </p>

            <p>{getDescription(order)}</p>

            {order.attempt_no && (
              <p>
                Intento actual: {order.attempt_no}
                {" · "}
                {order.webpay_local_state}
              </p>
            )}

            {order.has_webpay &&
              !order.has_mercado_pago &&
              order.attempt_no && (
              <button
                type="button"
                disabled={
                  checkingId !== null || loading
                }
                onClick={() =>
                  checkWebpay(order.order_id)
                }
              >
                {checkingId === order.order_id
                  ? "Consultando..."
                  : "Consultar Transbank"}
              </button>
            )}
          </article>
        ))}
      </div>

      <small>
        La consulta no crea pagos ni libera inventario.
        Las transacciones INITIALIZED requieren revisión.
      </small>
    </section>
  );
}
