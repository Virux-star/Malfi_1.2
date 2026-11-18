
import { useEffect, useState } from "react";

import { API_URL } from "../lib/api";

function AdminGuard({ children }) {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function checkSession() {
      try {
        const response = await fetch(
          `${API_URL}/api/admin/me`,
          {
            credentials: "include",
            signal: controller.signal
          }
        );

        if (response.status === 401) {
          setStatus("unauthorized");
        } else if (response.ok) {
          setStatus("authorized");
        } else {
          throw new Error("No se pudo verificar la sesión.");
        }

      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message);
          setStatus("error");
        }
      }
    }

    checkSession();

    return () => controller.abort();
  }, []);

  async function handleLogout() {
    try {
      const response = await fetch(
        `${API_URL}/api/admin/logout`,
        {
          method: "POST",
          credentials: "include"
        }
      );

      if (!response.ok) {
        throw new Error("No se pudo cerrar la sesión.");
      }

      window.location.replace("/admin/login");

    } catch (err) {
      setError(err.message);
    }
  }

  if (status === "loading") {
    return <p style={{ padding: 40 }}>Verificando sesión...</p>;
  }

  if (status === "unauthorized") {
    return (
      <main style={{ padding: 40, textAlign: "center" }}>
        <h1>Acceso restringido</h1>
        <p>Debes iniciar sesión para continuar.</p>
        <a href="/admin/login">Iniciar sesión</a>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main style={{ padding: 40 }}>
        <p role="alert">{error}</p>
        <a href="/admin/login">Volver al acceso</a>
      </main>
    );
  }

  return (
    <>
      <div className="admin-topbar">
        <span>Administración MALFI</span>
        <nav aria-label="Administración"><a href="/admin">Fotografía principal</a><a href="/admin/productos">Productos</a><a href="/admin/promociones">Promociones</a><a href="/admin/pedidos">Pedidos</a><a href="/admin/configuracion">Configuración y despachos</a><a href="/">Ver tienda</a></nav>
        <button type="button" className="secondary-button" onClick={handleLogout}>Cerrar sesión</button>
      </div>

      {error && <p role="alert">{error}</p>}

      {children}
    </>
  );
}

export default AdminGuard;
