import { clp } from '../lib/api';

export default function SalePrice({ price, originalPrice, percent }) {
  if (!(originalPrice > price)) return clp(price);
  return <span className="sale-price">
    <del aria-label="Precio anterior">{clp(originalPrice)}</del>
    <strong aria-label="Precio con descuento">{clp(price)}</strong>
    {percent && <small>−{percent} %</small>}
  </span>;
}
