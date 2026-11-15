import { useEffect, useState } from "react";

import { API_URL as API } from "../lib/api";

export default function AdminWebpayRetry({ orderId }) {
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function api(path, method = "GET") {
    const response = await fetch(`${API}${path}`, {
      method,
      credentials: "include",
      headers: method === "POST" ? { "Content-Type": "application/json" } : {}
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `Error HTTP ${response.status}`);
    return json;
  }

  async function refresh() {
    const data = await api(`/api/admin/webpay/test/history/${orderId}`);
    setHistory(data.attempts || []);
  }

  useEffect(() => {
    let mounted = true;
    setResult(null);
    setMessage("");
    api(`/api/admin/webpay/test/history/${orderId}`)
      .then(data => { if (mounted) setHistory(data.attempts || []); })
      .catch(err => { if (mounted) setMessage(err.message); });
    return () => { mounted = false; };
  }, [orderId]);

  async function verify() {
    setBusy(true);
    setResult(null);
    setMessage("");
    try {
      const data = await api(`/api/admin/webpay/test/check-retry/${orderId}`, "POST");
      setResult(data);
      setMessage(data.reason);
      await refresh();
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  function submitToTransbank(url, token) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "webpay3gint.transbank.cl") {
      throw new Error("La URL de Webpay no es valida.");
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = parsed.toString();
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "token_ws";
    input.value = token;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }

  async function retry() {
    if (!result?.canRetry || busy) return;
    if (!window.confirm("¿Iniciar un nuevo intento de Webpay para este pedido de prueba?")) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await api(`/api/admin/webpay/test/${orderId}`, "POST");
      submitToTransbank(data.url, data.token);
    } catch (err) { setMessage(err.message); setBusy(false); setResult(null); }
  }

  return (
    <section style={{ marginTop: 20, border: "1px solid #d8c8b4", padding: 16 }}>
      <h3>Historial de pagos Webpay (pruebas)</h3>
      {history.length ? (
        <ul>{history.map(a => (
          <li key={a.attempt_no}>Intento {a.attempt_no}: {a.state}
            {a.is_current ? " · actual" : " · histórico"}
            {a.return_reason ? ` · ${a.return_reason}` : ""}</li>
        ))}</ul>
      ) : <p>Este pedido todavía no tiene intentos.</p>}
      <button type="button" disabled={busy} onClick={verify}>
        {busy ? "Consultando..." : "Verificar si se puede reintentar"}
      </button>
      {result?.canRetry && (
        <button type="button" disabled={busy} onClick={retry}
          style={{ marginLeft: 12 }}>
          Reintentar pago con Webpay
        </button>
      )}
      {message && <p role="status">{message}</p>}
      <small>Solo para pedidos pendientes con reserva activa. Nunca reintentar un pago autorizado.</small>
    </section>
  );
}
