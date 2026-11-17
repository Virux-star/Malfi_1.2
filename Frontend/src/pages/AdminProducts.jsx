import WorkshopDatesFields from '../components/WorkshopDatesFields';
import ProductOptionsFields, { optionsFromText } from '../components/ProductOptionsFields';
import ProductImagesInput, { appendProductPhotos } from '../components/ProductImagesInput';
import { useRef, useState } from "react";
import "./AdminProducts.css";
import AdminProductManager from "../components/AdminProductManager";

import { API_URL } from "../lib/api";

const initialForm = {
  name: "",
  description: "",
  price: "",
  category: "Velas de soja",
  stock: "",
  colors: "",
  aromas: "",
    workshopDates: []
};

function AdminProducts() {
  const [form, setForm] = useState(initialForm);
  const [photos, setPhotos] = useState([]);
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

    if (!photos.length) {
      setMessage("Debes seleccionar una fotografía");
      return;
    }

    const formData = new FormData();

    formData.append("name", form.name);
    formData.append("description", form.description);
    formData.append("price", form.price);
    formData.append("category", form.category);
    formData.append("stock", form.stock);
    formData.append("colors", JSON.stringify(optionsFromText(form.colors)));
    formData.append("aromas", JSON.stringify(optionsFromText(form.aromas)));
    formData.append("workshopDates", JSON.stringify(form.category === "Talleres" ? form.workshopDates : []));
    appendProductPhotos(formData, photos);

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
      setPhotos([]);

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

            <option value="Decoración de concreto">
              Decoración de concreto
            </option>

            <option value="Set de velas">
              Set de velas
            </option>
            <option value="Talleres">
              Talleres
            </option>
            <option value="Insumos">
              Insumos
            </option>
          </select>
        </label>

        <label>
          {form.category === "Talleres" ? "Cupos totales disponibles" : "Stock disponible (unidades)"}
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

        {form.category === "Talleres" && <WorkshopDatesFields dates={form.workshopDates} onChange={handleChange} disabled={uploading} />}
        <ProductOptionsFields colors={form.colors} aromas={form.aromas} onChange={handleChange} disabled={uploading} />
        <ProductImagesInput photos={photos} onChange={setPhotos} disabled={uploading} />

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
