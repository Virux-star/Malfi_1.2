-- Additive migration. Keeps existing Webpay orders, products, stock and sessions.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'webpay'
  CHECK (payment_provider IN ('webpay','mercadopago'));
CREATE TABLE IF NOT EXISTS mercadopago_checkouts (
  id uuid PRIMARY KEY,
  order_id bigint NOT NULL UNIQUE REFERENCES orders(id),
  mode text NOT NULL CHECK (mode IN ('integration','production')),
  amount_clp bigint NOT NULL CHECK (amount_clp > 0),
  external_reference text NOT NULL UNIQUE,
  collector_id text NOT NULL,
  preference_id text UNIQUE,
  checkout_url text,
  return_state_hash text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'starting' CHECK (state IN ('starting','created','pending','paid','review')),
  settled_payment_id text,
  preference_expires_at timestamptz NOT NULL,
  last_error text,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mercadopago_payments (
  payment_id text PRIMARY KEY,
  checkout_id uuid NOT NULL REFERENCES mercadopago_checkouts(id),
  merchant_order_id text NOT NULL,
  provider_status text NOT NULL,
  status_detail text,
  amount_clp bigint NOT NULL,
  refunded_clp bigint NOT NULL DEFAULT 0,
  live_mode boolean NOT NULL,
  payment_method_id text,
  payment_type_id text,
  card_last4 varchar(4),
  approved_at timestamptz,
  provider_updated_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mercadopago_reconciliation ON mercadopago_checkouts (last_reconciled_at,created_at);
CREATE INDEX IF NOT EXISTS mercadopago_checkout_payments ON mercadopago_payments(checkout_id,observed_at DESC);
