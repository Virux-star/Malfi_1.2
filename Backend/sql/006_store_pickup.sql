ALTER TABLE orders
  ADD COLUMN delivery_method varchar(20) NOT NULL DEFAULT 'shipping'
    CHECK (delivery_method IN ('shipping', 'pickup'));

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending_payment', 'preparing', 'shipped', 'delivered', 'cancelled', 'payment_review', 'ready_for_pickup'));

ALTER TABLE orders ADD CONSTRAINT orders_pickup_fulfillment_check
  CHECK (
    (delivery_method <> 'pickup' OR (shipping_clp = 0 AND status <> 'shipped'))
    AND (status <> 'ready_for_pickup' OR delivery_method = 'pickup')
  );
