import { useEffect, useState } from "react";
import ProductCard from "./ProductCard";
import "./ProductCatalog.css";

import { API_URL } from "../lib/api";

function ProductCatalog() {

  // Productos obtenidos desde PostgreSQL
  const [products, setProducts] = useState([]);

  // Categoría seleccionada
  const [selectedCategory, setSelectedCategory] = useState("Todos");

  // Estado de carga
  const [loading, setLoading] = useState(true);

  // Manejo de errores
  const [error, setError] = useState("");

  const categories = [
    "Todos",
    "Velas de soja",
    "Set de velas",
    "Decoración de concreto",
    "Talleres",
    "Insumos",
  ];

  // Obtener productos desde nuestro backend
  useEffect(() => {
    const controller = new AbortController();

    async function fetchProducts() {
      try {
        const response = await fetch(
          `${API_URL}/api/products`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("Error al obtener productos");
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("Formato de productos no válido");
        }

        setProducts(data);

      } catch (error) {
        if (error.name !== "AbortError") {
          console.error(error);
          setError("No pudimos cargar los productos.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchProducts();

    return () => controller.abort();
  }, []);

  // Filtrar productos por categoría
  const filteredProducts =
    selectedCategory === "Todos"
      ? products
      : products.filter(
          (product) => product.category === selectedCategory
        );

  return (
    <section className="catalog" id="tienda">

      <div className="catalog-container">

        {/* Encabezado */}
        <div className="catalog-header">

          <h2>Nuestra colección</h2>

          <p>
            Descubre velas aromáticas de cera de soja
            y piezas decorativas creadas para
            darle calidez a tus espacios.
          </p>

        </div>

        {/* Filtros */}
        <div
          className="catalog-filters"
          role="group"
          aria-label="Filtrar productos por categoría"
        >

          {categories.map((category) => (

            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              aria-pressed={selectedCategory === category}
              className={
                selectedCategory === category
                  ? "filter-btn active"
                  : "filter-btn"
              }
            >
              {category}
            </button>

          ))}

        </div>

        {/* Estado de carga */}
        {loading && (
          <p className="catalog-message" role="status">
            Cargando productos...
          </p>
        )}

        {/* Error */}
        {!loading && error && (
          <p className="catalog-message" role="alert">
            {error}
          </p>
        )}

        {/* Catálogo */}
        {!loading && !error && (

          filteredProducts.length > 0 ? (

            <div className="products-grid">

              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                />
              ))}

            </div>

          ) : (

            <p className="catalog-message">
              No hay productos disponibles en esta categoría.
            </p>

          )

        )}

      </div>

    </section>
  );
}

export default ProductCatalog;
