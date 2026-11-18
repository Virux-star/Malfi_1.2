import SalePrice from '../components/SalePrice';
function ProductCard({ product }) {

  const outOfStock = Number(product.stock) === 0;

  return (
    <article className="product-card">

      <a
        href={`/producto/${product.id}`}
        className="product-card-link"
      >

        <div className="product-image">

          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
            />
          ) : (
            <div className="product-no-image">
              MALFI
            </div>
          )}

          {outOfStock && (
            <span className="product-badge">
              Agotado
            </span>
          )}

        </div>

        <div className="product-info">

          <span className="product-category">
            {product.category}
          </span>

          <h3 className="product-name">
            {product.name}
          </h3>

          <p className="product-price">
            <SalePrice price={product.price} originalPrice={product.originalPrice} percent={product.offerPercent}/>
          </p>

        </div>

      </a>

    </article>
  );
}

export default ProductCard;
