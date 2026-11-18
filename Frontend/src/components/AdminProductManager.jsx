import WorkshopDatesFields from './WorkshopDatesFields';
import ProductOptionsFields, { optionsFromText } from './ProductOptionsFields';
import ProductImagesInput, { appendProductPhotos } from './ProductImagesInput';

import { useEffect, useRef, useState } from "react";
import "./AdminProductManager.css";

import { API_URL } from "../lib/api";

const formatPrice = (price) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(price);

function AdminProductManager() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [photos, setPhotos] = useState([]);

  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState(null);

  const fileInputRef = useRef(null);
  const editSectionRef = useRef(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    category: "Velas de soja",
    stock: "",
    colors: "",
    aromas: "",
    sandColors: "",
    workshopTimes: "",
    workshopDates: []
  });

  // Obtener todos los productos, incluidos los ocultos
  async function loadProducts() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/products`,
        {
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudieron cargar los productos."
        );
      }

      if (!Array.isArray(data)) {
        throw new Error("Respuesta de productos no válida.");
      }

      setProducts(data);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  // Preparar el formulario de edición
  function startEditing(product) {
    setEditingId(product.id);

    setForm({
      name: product.name,
      description: product.description || "",
      price: String(product.price),
      category: product.category,
      stock: String(product.stock),
      colors: (product.colors || []).join("\n"),
      sandColors: (product.sand_colors || []).join("\n"),
      aromas: (product.aromas || []).join("\n"),
      workshopTimes: (product.workshop_times || []).join("\n"),
      workshopDates: product.workshop_dates || []
    });

    setPhotos((product.images || (product.image_url ? [product.image_url] : [])).map(url => ({ url })));
    setMessage("");
    setError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    requestAnimationFrame(() => {
      editSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }

  function cancelEditing() {
    setEditingId(null);
    setPhotos([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value
    }));
  }

  // Guardar cambios
  async function handleSave(event) {
    event.preventDefault();

    if (editingId === null || saving) return;

    if (!photos.length) { setError("El producto debe tener al menos una fotografía."); return; }

    const formData = new FormData();

    formData.append("name", form.name);
    formData.append("description", form.description);
    formData.append("price", form.price);
    formData.append("category", form.category);
    formData.append("stock", form.stock);

    formData.append("colors", JSON.stringify(optionsFromText(form.colors)));
    formData.append("sandColors", JSON.stringify(optionsFromText(form.sandColors)));
    formData.append("aromas", JSON.stringify(optionsFromText(form.aromas)));
    formData.append("workshopTimes", JSON.stringify(form.category === "Talleres" ? optionsFromText(form.workshopTimes) : []));
    formData.append("workshopDates", JSON.stringify(form.category === "Talleres" ? form.workshopDates : []));
    appendProductPhotos(formData, photos);

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/products/${editingId}`,
        {
          method: "PUT",
          credentials: "include",
          body: formData
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo actualizar el producto."
        );
      }

      cancelEditing();

      setMessage("¡Producto actualizado correctamente!");

      await loadProducts();

    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Ocultar o volver a publicar
  async function changeStatus(product) {
    const nextActive = !product.active;

    if (!nextActive) {
      const confirmed = window.confirm(
        `¿Quieres ocultar "${product.name}" de la tienda?`
      );

      if (!confirmed) return;
    }

    setChangingId(product.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/admin/products/${product.id}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            active: nextActive
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "No se pudo cambiar el estado."
        );
      }

      setMessage(data.message);
      await loadProducts();

    } catch (err) {
      setError(err.message);
    } finally {
      setChangingId(null);
    }
  }

  return (
    <section className="admin-product-manager">

      <div className="manager-heading">
        <div>
          <span>MALFI · INVENTARIO</span>
          <h2>Mis productos</h2>
          <p>
            Edita los productos publicados y administra
            su disponibilidad.
          </p>
        </div>

        <button
          type="button"
          className="manager-refresh"
          onClick={loadProducts}
          disabled={loading}
        >
          Actualizar lista
        </button>
      </div>

      {message && (
        <p className="manager-success" role="status">
          {message}
        </p>
      )}

      {error && (
        <p className="manager-error" role="alert">
          {error}
        </p>
      )}

      {/* FORMULARIO DE EDICIÓN */}
      {editingId !== null && (
        <div
          className="manager-edit"
          ref={editSectionRef}
        >
          <h3>Editar producto #{editingId}</h3>

          <form
            className="manager-edit-form"
            onSubmit={handleSave}
          >
            <label>
              Nombre
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

            <div className="manager-form-row">
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
                {form.category === "Talleres" ? "Cupos totales" : "Stock (unidades)"}
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
            </div>

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

            {form.category === "Talleres" && <WorkshopDatesFields dates={form.workshopDates} times={form.workshopTimes} onChange={handleChange} disabled={saving} />}
        <ProductOptionsFields colors={form.colors} aromas={form.aromas} sandColors={form.sandColors} onChange={handleChange} disabled={saving} />
            <ProductImagesInput photos={photos} onChange={setPhotos} disabled={saving} />

            <div className="manager-actions">
              <button
                type="submit"
                disabled={saving}
                className="manager-save"
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>

              <button
                type="button"
                className="manager-cancel"
                onClick={cancelEditing}
                disabled={saving}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LISTA DE PRODUCTOS */}
      {loading && (
        <p role="status">Cargando productos...</p>
      )}

      {!loading && products.length === 0 && (
        <p>Todavía no hay productos registrados.</p>
      )}

      {!loading && (
        <div className="manager-products-grid">
          {products.map((product) => (
            <article
              key={product.id}
              className="manager-product-card"
            >
              <div className="manager-product-image">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    loading="lazy"
                  />
                ) : (
                  <span>MALFI</span>
                )}
              </div>

              <div className="manager-product-info">

                <span className={
                  product.active
                    ? "manager-status active"
                    : "manager-status inactive"
                }>
                  {product.active ? "Publicado" : "Oculto"}
                </span>

                <h3>{product.name}</h3>

                <p>{product.category}</p>

                <strong>
                  {formatPrice(product.price)}
                </strong>

                <p>Stock: {product.stock}</p>

                <div className="manager-card-buttons">
                  <button
                    type="button"
                    className="manager-edit-button"
                    onClick={() => startEditing(product)}
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    className="manager-status-button"
                    disabled={changingId === product.id}
                    onClick={() => changeStatus(product)}
                  >
                    {changingId === product.id
                      ? "Guardando..."
                      : product.active
                        ? "Ocultar"
                        : "Reactivar"}
                  </button>
                </div>

              </div>
            </article>
          ))}
        </div>
      )}

    </section>
  );
}

export default AdminProductManager;
