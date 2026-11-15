
import { useState } from "react";
import "./AdminLogin.css";

import { API_URL } from "../lib/api";

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/api/admin/login`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email,
            password
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo iniciar sesión."
        );
      }

      window.location.replace("/admin/pedidos");

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-page">
      <div className="admin-login-container">

        <a href="/" className="admin-login-logo">
          MALFI
        </a>

        <span className="admin-login-label">
          PANEL DE ADMINISTRACIÓN
        </span>

        <div className="admin-login-card">
          <h1>Bienvenida</h1>

          <p>
            Ingresa tus credenciales para administrar MALFI.
          </p>

          <form onSubmit={handleSubmit}>

            <label htmlFor="admin-email">
              Correo electrónico
            </label>

            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label htmlFor="admin-password">
              Contraseña
            </label>

            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {error && (
              <p role="alert" className="admin-login-error">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading}>
              {loading ? "Ingresando..." : "Iniciar sesión"}
            </button>

          </form>
        </div>

        <a href="/" className="admin-login-back">
          ← Volver a la tienda
        </a>

      </div>
    </main>
  );
}

export default AdminLogin;
