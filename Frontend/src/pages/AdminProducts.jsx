import { useRef, useState } from "react";
import "./AdminProducts.css";
import AdminProductManager from "../components/AdminProductManager";

import { API_URL } from "../lib/api";

const initialForm = {
  name: "",
  description: "",
  price: "",
  category: "Velas de soja",
  stock: ""
};

function AdminProducts() {
  const [form, setForm] = useState(initialForm);
  const [image, setImage] = useState(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef(null);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!image) {
      setMessage("Debes seleccionar una fotografía");
      return;
    }

    if (image.size > 5 * 1024 * 1024) {
      setMessage("La fotografía no puede superar los 5 MB");
      return;
    }

    const formData = new FormData();

    formData.append("name", form.name);
    formData.append("description", form.description);
    formData.append("price", form.price);
    formData.append("category", form.category);
    formData.append("stock", form.stock);
    formData.append("image", image);

    setUploading(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/products`,
        {
          method: "POST",
          credentials: "include",
          body: formData
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo registrar el producto"
        );
      }

      setMessage("¡Producto publicado correctamente!");

      setForm(initialForm);
      setImage(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="admin-products">

      <h1>Administración MALFI</h1>

      <p>Agregar nuevo producto</p>

      <form onSubmit={handleSubmit}>

        <label>
          Nombre del producto
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            maxLength={150}
            required
          />
        </label>

        <label>
          Descripción
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            maxLength={2000}
            rows={4}
          />
        </label>

        <label>
          Precio (CLP)
          <input
            type="number"
            name="price"
            value={form.price}
            onChange={handleChange}
            min="1"
            step="1"
            required
          />
        </label>

        <label>
          Categoría
          <select
            name="category"
            value={form.category}
            onChange={handleChange}
          >
            <option value="Velas de soja">
              Velas de soja
            </option>

            <option value="Decoración de cemento">
              Decoración de cemento
            </option>

            <option value="Set de velas">
              Set de velas
            </option>
          </select>
        </label>

        <label>
          Stock disponible
          <input
            type="number"
            name="stock"
            value={form.stock}
            onChange={handleChange}
            min="0"
            step="1"
            required
          />
        </label>

        <label>
          Fotografía del producto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            ref={fileInputRef}
            onChange={(e) =>
              setImage(e.target.files[0] || null)
            }
            required
          />
        </label>

        <button type="submit" disabled={uploading}>
          {uploading ? "Publicando..." : "Publicar producto"}
        </button>

                <p role="status">{message}</p>
      </form>

      {/* Administrar productos existentes */}
      <AdminProductManager />

    </main>
  );
}

export default AdminProducts;
