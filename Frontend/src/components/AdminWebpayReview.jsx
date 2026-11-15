
import { useEffect, useState } from "react";

const API_URL = (
  import.meta.env.VITE_API_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

export default function AdminWebpayReview({ orderId }) {
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadPayment() {
    const response = await fetch(
      `${API_URL}/api/admin/webpay/test/status/${orderId}`,
      {
        credentials: "include"
      }
    );

    if (response.status === 404) {
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "No se pudo consultar Webpay."
      );
    }

    return data;
  }

  useEffect(() => {
    let active = true;

    setPayment(null);
    setError("");
    setMessage("");
    setLoading(true);

    loadPayment()
      .then((data) => {
        if (active) setPayment(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId]);

  async function verifyPayment() {
    if (checking) return;

    const confirmed = window.confirm(
      "¿Quieres consultar el resultado del pago con Transbank? " +
      "Esta operación no crea otro cobro."
    );

    if (!confirmed) return;

    setChecking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/webpay/test/reconcile/${orderId}`,
        {
          method: "POST",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo verificar el pago."
        );
      }

      if (data.outcome === "payment_review") {
        setMessage(
          "Transbank confirmó el pago, pero el pedido " +
          "requiere revisión de inventario. No despachar."
        );
      } else if (data.outcome === "already_paid") {
        setMessage(
          "Este pedido ya estaba pagado. " +
          "No se descontó nuevamente el inventario."
        );
      } else {
        setMessage(
          "Pago verificado y pedido actualizado correctamente."
        );
      }

      const updated = await loadPayment();
      setPayment(updated);

    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return <p>Consultando Webpay...</p>;
  }

  if (!payment && !error) {
    return null;
  }

  const alreadyPaid = payment?.payment_status === "paid";

  return (
    <section className="admin-webpay-review">
      <h3>Verificación de Webpay Plus</h3>

      {payment && (
        <>
          <p>
            <strong>Estado Webpay:</strong>{" "}
            {payment.webpay_state}
          </p>

          <p>
            <strong>Estado del pago MALFI:</strong>{" "}
            {payment.payment_status}
          </p>

          <p>
            <strong>Importe:</strong>{" "}
            ${Number(payment.amount_clp).toLocaleString("es-CL")}
          </p>

          {alreadyPaid ? (
            <p className="orders-admin-success">
              El pago ya está registrado en MALFI.
              {payment.order_status === "payment_review"
                ? " Requiere revisar el inventario antes de despachar."
                : ""}
            </p>
          ) : (
            <button
              type="button"
              className="orders-admin-action"
              onClick={verifyPayment}
              disabled={checking}
            >
              {checking
                ? "Verificando..."
                : "Verificar pago con Transbank"}
            </button>
          )}
        </>
      )}

      {message && (
        <p role="status" className="orders-admin-success">
          {message}
        </p>
      )}

      {error && (
        <p role="alert" className="orders-admin-error">
          {error}
        </p>
      )}
    </section>
  );
}
