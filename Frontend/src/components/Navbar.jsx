
import { useState } from "react";
import "./Navbar.css";
import { useCart } from "../context/CartContext";

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const { cartCount } = useCart();

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <header className="navbar">
      <div className="navbar-container">

        {/* Logo */}
        <a
          href="/#inicio"
          className="navbar-logo"
          onClick={closeMenu}
        >
          MALFI
        </a>

        {/* Botón de menú móvil */}
        <button
          className="menu-toggle"
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={menuOpen}
          aria-controls="navbar-links"
        >
          {menuOpen ? "✕" : "☰"}
        </button>

        {/* Enlaces */}
        <nav
          id="navbar-links"
          className={`navbar-links ${menuOpen ? "active" : ""}`}
          aria-label="Navegación principal"
        >
          <a href="/#inicio" onClick={closeMenu}>
            Inicio
          </a>

          <a href="/#tienda" onClick={closeMenu}>
            Tienda
          </a>

          <a href="/#nosotros" onClick={closeMenu}>
            Nosotros
          </a>

          <a href="/#contacto" onClick={closeMenu}>
            Contacto
          </a>
        </nav>

        {/* Carrito */}
        <a
          href="/carrito"
          className="navbar-cart"
          aria-label="Ver carrito"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
          </svg>

          {cartCount > 0 && (
  <span className="cart-count">{cartCount}</span>
)}
        </a>

      </div>
    </header>
  );
}

export default Navbar;
