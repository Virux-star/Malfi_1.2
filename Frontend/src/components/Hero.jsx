import { useEffect, useState } from "react";
import "./Hero.css";

import { API_URL } from "../lib/api";

function Hero() {
  const [imageUrl, setImageUrl] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHero() {
      try {
        const response = await fetch(`${API_URL}/api/hero`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("No se pudo cargar el Hero");
        }

        const data = await response.json();
        setImageUrl(data.imageUrl);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error(error);
        }
      }
    }

    loadHero();

    return () => controller.abort();
  }, []);

  return (
    <section className="hero" id="inicio">
      <div className="hero-content">
        <h1>
          Pequeños detalles,
          <br />
          grandes momentos.
        </h1>

        <p>
          Velas aromáticas y piezas decorativas creadas
          para transformar tus espacios en lugares únicos.
        </p>

        <a href="#tienda" className="hero-button">
          Explorar colección
          <span aria-hidden="true"> →</span>
        </a>
      </div>

      <div className="hero-image">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Colección de velas y decoración MALFI"
          />
        ) : (
          <div className="hero-placeholder">
            <span>MALFI</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default Hero;
