CREATE TABLE IF NOT EXISTS store_settings (
  key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_key uuid UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_fingerprint text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token_hash text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_mode text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_snapshot jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_days_min integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_days_max integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE shipping_rates_comunas ADD COLUMN IF NOT EXISTS delivery_days_min integer;
ALTER TABLE shipping_rates_comunas ADD COLUMN IF NOT EXISTS delivery_days_max integer;
ALTER TABLE shipping_rates_comunas ADD COLUMN IF NOT EXISTS santiago_coverage boolean NOT NULL DEFAULT false;
ALTER TABLE shipping_rates_comunas ADD COLUMN IF NOT EXISTS verified_at timestamptz;
-- Existing tariffs require explicit confirmation of their real cost, coverage and delivery time.
-- Nothing here deletes or overwrites catalogues, orders, sessions or existing prices.
CREATE UNIQUE INDEX IF NOT EXISTS shipping_comuna_normalized ON shipping_rates_comunas (lower(trim(region)),lower(trim(comuna)));
CREATE INDEX IF NOT EXISTS orders_expiry_pending ON orders(expires_at) WHERE inventory_reserved AND payment_status='pending';
CREATE TABLE IF NOT EXISTS webpay_payments (
  id uuid PRIMARY KEY, order_id bigint NOT NULL REFERENCES orders(id),
  buy_order varchar(26) UNIQUE NOT NULL, session_id varchar(61) NOT NULL,
  amount_clp bigint NOT NULL CHECK(amount_clp>0), mode text NOT NULL CHECK(mode IN ('integration','production')),
  token_ws text UNIQUE, checkout_url text,
  state text NOT NULL CHECK(state IN ('starting','created','processing','authorized','paid','failed','review')),
  response_code integer, bank_status text, authorization_code text, payment_type_code text,
  card_last4 varchar(4), bank_transaction_date timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS webpay_one_active_payment ON webpay_payments(order_id) WHERE state<>'failed';
CREATE INDEX IF NOT EXISTS webpay_needs_reconciliation ON webpay_payments(updated_at) WHERE state IN ('created','processing','authorized','review','starting');
ALTER TABLE order_email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
