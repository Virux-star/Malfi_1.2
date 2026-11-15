import { useStore } from '../context/StoreContext';
export default function Footer(){
  const {store}=useStore(),b=store?.business;
  return <footer className="site-footer"><div><a href="/" className="footer-brand">MALFI</a><p>Velas aromáticas de cera de soja<br/>y decoración artesanal de concreto.</p><small>Hecho con dedicación, desde Las Condes.</small></div><nav aria-label="Información de la tienda"><a href="/despachos">Despachos</a><a href="/terminos">Términos, cambios y devoluciones</a><a href="/privacidad">Privacidad</a><a href="/#contacto">Contacto</a></nav><div>{b?.legalName&&<p>{b.legalName}<br/>RUT {b.rut}</p>}{b?.email&&<a href={`mailto:${b.email}`}>{b.email}</a>}<a href="https://www.instagram.com/malfi.candles/" target="_blank" rel="noreferrer">@malfi.candles</a><small>© {new Date().getFullYear()} MALFI</small></div></footer>;
}
