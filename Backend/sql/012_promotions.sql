CREATE TABLE promotions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('offer','coupon')),
  name varchar(100) NOT NULL,
  code varchar(32) UNIQUE,
  percent smallint NOT NULL CHECK (percent BETWEEN 1 AND 99),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  category text,
  product_ids integer[] NOT NULL DEFAULT '{}',
  min_subtotal integer NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_uses integer CHECK (max_uses > 0),
  enabled boolean NOT NULL DEFAULT true,
  CHECK ((kind = 'coupon') = (code IS NOT NULL)),
  CHECK (kind = 'coupon' OR (min_subtotal = 0 AND max_uses IS NULL)),
  CHECK (category IS NULL OR cardinality(product_ids) = 0)
);
ALTER TABLE orders ADD COLUMN coupon_id integer REFERENCES promotions(id),
  ADD COLUMN coupon_code varchar(32),
  ADD COLUMN discount_clp bigint NOT NULL DEFAULT 0 CHECK (discount_clp >= 0);
ALTER TABLE order_items ADD COLUMN original_price_clp integer,
  ADD COLUMN promotion_name varchar(100);
CREATE INDEX orders_coupon_uses ON orders(coupon_id) WHERE coupon_id IS NOT NULL;
