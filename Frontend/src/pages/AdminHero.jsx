import { useState } from "react";

import { API_URL } from "../lib/api";

function AdminHero() {
  const [image, setImage] = useState(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!image) {
      setMessage("Selecciona una fotografía.");
      return;
    }

    const formData = new FormData();
    formData.append("image", image);

    setUploading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/api/admin/hero`, {
        method: "POST",
        credentials: "include",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error al subir la imagen");
      }

      setMessage("¡Imagen del Hero actualizada correctamente!");
      setImage(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: "80px auto", padding: 24 }}>
      <h1>Administración MALFI</h1>

      <p style={{ margin: "20px 0" }}>
        Cambiar fotografía principal de la tienda.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: "grid", gap: 20 }}
      >
        <label>
          Fotografía del Hero
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setImage(event.target.files[0] || null)}
            required
            style={{ display: "block", marginTop: 10 }}
          />
        </label>

        <button
          type="submit"
          disabled={uploading}
          style={{
            background: "#49382e",
            color: "#fff",
            border: "none",
            padding: 16
          }}
        >
          {uploading ? "Subiendo..." : "Guardar fotografía"}
        </button>
      </form>

      <p role="status" style={{ marginTop: 20 }}>
        {message}
      </p>
    </main>
  );
}

export default AdminHero;
