import { useEffect } from "react";
import Footer from "./components/Footer";
import Information from "./pages/Information";
import OrderResult from "./pages/OrderResult";
import AdminSettings from "./pages/AdminSettings";
import { useStore } from "./context/StoreContext";

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
        <section className="store-details" aria-label="Comprar en MALFI"><div><h3>Hecho a mano</h3><p>Cera de soja, aromas y piezas de cemento que acompañan tus espacios.</p></div><div><h3>Desde Las Condes</h3><p>Despachos con Paket en la cobertura de Santiago y Blue Express a otros destinos habilitados.</p><a className="text-link" href="/despachos">Conocer los despachos</a></div><div><h3>Compra con tranquilidad</h3><p>Conoce las condiciones de compra, el retracto y la garantía legal antes de elegir.</p><a className="text-link" href="/terminos">Cambios y devoluciones</a></div></section>

        <section
          id="nosotros"
          style={{
            padding: "100px 5%",
            textAlign: "center",
            backgroundColor: "#f3ece4"
          }}
        >
          <h2>Sobre MALFI</h2>

          <p style={{ marginTop: 20 }}>
            Velas aromáticas de cera de soja
            y decoración artesanal de cemento.
          </p>
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
          {store?.business.email && <p style={{ marginTop: 20 }}><a href={`mailto:${store.business.email}`}>{store.business.email}</a> · {store.business.phone}</p>}
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
