import { useEffect } from "react";
import Footer from "./components/Footer";
import Information from "./pages/Information";
import OrderResult from "./pages/OrderResult";
import AdminSettings from "./pages/AdminSettings";
import { useStore } from "./context/StoreContext";
import { clp } from "./lib/api";

import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import ProductCatalog from "./components/ProductCatalog";

import AdminHero from "./pages/AdminHero";
import AdminProducts from "./pages/AdminProducts";
import ProductDetail from "./pages/ProductDetail";
import CartPage from "./pages/CartPage";
import Checkout from "./pages/Checkout";
import AdminOrders from "./pages/AdminOrders";
import AdminLogin from "./pages/AdminLogin";
import AdminGuard from "./components/AdminGuard";

function HomePage() {
  const { store } = useStore();

  useEffect(() => {
    if (window.location.hash) {
      const sectionId = decodeURIComponent(
        window.location.hash.substring(1)
      );

      window.requestAnimationFrame(() => {
        document
          .getElementById(sectionId)
          ?.scrollIntoView();
      });
    }
  }, []);

  return (
    <>
      <Navbar />

      <main>
        <Hero />

        <ProductCatalog />
        <section className="store-details" aria-label="Comprar en MALFI"><div><h3>Hecho a mano</h3><p>Cera de soja, aromas y piezas de concreto que acompañan tus espacios.</p></div><div><h3>Despacho</h3><p>Envíos con Paket en Santiago y Blue Express a otros destinos habilitados. También contamos con retiro en tienda.</p>{store?.shippingPolicy&&<p>Despacho gratis desde {clp(store.shippingPolicy.freeFromClp)} en productos.</p>}<a className="text-link" href="/despachos">Despachos y retiro en tienda</a></div><div><h3>Compra con tranquilidad</h3><p>Conoce las condiciones de compra, el retracto y la garantía legal antes de elegir.</p><a className="text-link" href="/terminos">Cambios y devoluciones</a></div></section>

        <section
          id="nosotros"
          style={{
            padding: "100px 5%",
            textAlign: "center",
            backgroundColor: "#f3ece4"
          }}
        >
          <h2>Sobre MALFI</h2>

          <div
            style={{
              maxWidth: 780,
              margin: "28px auto 0",
              textAlign: "left",
              display: "grid",
              gap: 20,
              lineHeight: 1.8
            }}
          >
            <p>
              MALFI nació a finales de 2022, a partir de una idea que poco a poco se transformó en un proyecto lleno de creatividad, dedicación y pasión por los detalles.
            </p>
            <p>
              Detrás de MALFI hay una persona que está presente en cada etapa del proceso: desde la creación de cada diseño y la elección de los materiales, hasta la elaboración y terminación de cada pieza.
            </p>
            <p>
              Creamos velas de cera de soja y piezas decorativas en concreto, todas hechas a mano, buscando siempre un equilibrio entre diseño, aroma y funcionalidad.
            </p>
            <p>
              Creemos en la belleza de las cosas simples, en los espacios que transmiten calma y en esos pequeños detalles que hacen que un lugar se sienta especial.
            </p>
            <p>
              Cada creación lleva tiempo, dedicación y una parte de este proyecto. Por eso, ninguna pieza es exactamente igual a otra.
            </p>
            <p>
              <em>MALFI es nuestra forma de transformar ideas en objetos que acompañan momentos y dan vida a los espacios.</em>
            </p>
            <p>
              Gracias por valorar y ser parte de este proyecto hecho a mano en Chile.
            </p>
          </div>
        </section>

        <section
          id="contacto"
          style={{
            padding: "100px 5%",
            textAlign: "center"
          }}
        >
          <h2>Conecta con MALFI</h2>

          <a
            href="https://www.instagram.com/malfi.candles/"
            target="_blank"
            rel="noopener noreferrer"
          >
            @malfi.candles
          </a>
          {store?.business.email && <p style={{ marginTop: 20 }}><a href={`mailto:${store.business.email}`}>{store.business.email}</a> · <a href={`tel:${store.business.phone.replace(/[^\d+]/g,'')}`}>{store.business.phone}</a></p>}
        </section>
      </main>
      <Footer />
    </>
  );
}

function App() {
  const path =
    window.location.pathname.replace(/\/+$/, "") || "/";

  useEffect(() => {
    const titles = { "/": "MALFI · Velas de soja y decoración artesanal", "/checkout": "Finalizar compra · MALFI", "/carrito": "Tu carrito · MALFI" };
    document.title = titles[path] || (path.startsWith("/admin") ? "Administración · MALFI" : "MALFI · Velas y decoración");
    if (path.startsWith("/admin") || path.startsWith("/pedido")) {
      const meta = document.createElement("meta"); meta.name="robots"; meta.content="noindex,nofollow"; document.head.append(meta);
      return () => meta.remove();
    }
  }, [path]);

  if (path === "/admin/configuracion") return <AdminGuard><AdminSettings /></AdminGuard>;
  if (["/terminos", "/privacidad", "/despachos"].includes(path)) return <><Navbar /><Information page={path.slice(1)} /><Footer /></>;
  const orderMatch = path.match(/^\/pedido\/([1-9]\d*)$/);
  if (orderMatch) return <><Navbar /><OrderResult orderId={orderMatch[1]} /><Footer /></>;
  if (path === "/pedido") return <><Navbar /><main className="content-page"><h1>Consulta tu pedido</h1><p>Abre el enlace privado que recibiste al comprar o en tu correo de confirmación. Si necesitas ayuda, contáctanos con el número de pedido.</p><a className="text-link" href="/#contacto">Contactar a MALFI</a></main><Footer /></>;

  if (path === "/admin/login") {
    return <AdminLogin />;
  }

  if (path === "/admin/pedidos") {
    return (
      <AdminGuard>
        <AdminOrders />
      </AdminGuard>
    );
  }

  if (path === "/admin/productos") {
    return (
      <AdminGuard>
        <AdminProducts />
      </AdminGuard>
    );
  }

  if (path === "/admin") {
    return (
      <AdminGuard>
        <AdminHero />
      </AdminGuard>
    );
  }

  if (path === "/checkout") {
    return (
      <>
        <Navbar />
        <Checkout /><Footer />
      </>
    );
  }

  if (path === "/carrito") {
    return (
      <>
        <Navbar />
        <CartPage /><Footer />
      </>
    );
  }

  const productMatch = path.match(
    /^\/producto\/([1-9]\d*)$/
  );

  if (productMatch) {
    return (
      <>
        <Navbar />
        <ProductDetail productId={productMatch[1]} /><Footer />
      </>
    );
  }

  if (path === "/") {
    return <HomePage />;
  }

  return (
    <main style={{ padding: 40, textAlign: "center" }}>
      <h1>Página no encontrada</h1>
      <a href="/">Volver a MALFI</a>
    </main>
  );
}

export default App;
