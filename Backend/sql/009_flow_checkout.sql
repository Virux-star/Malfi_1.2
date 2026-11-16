-- Adds Flow without changing existing orders, amounts, reservations or credentials.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN ('webpay','mercadopago','flow'));

CREATE TABLE IF NOT EXISTS flow_checkouts (
  id uuid PRIMARY KEY,
  order_id bigint NOT NULL UNIQUE REFERENCES orders(id),
  mode text NOT NULL CHECK (mode IN ('integration','production')),
  credential_id varchar(64) NOT NULL,
  commerce_order text NOT NULL UNIQUE,
  amount_clp bigint NOT NULL CHECK (amount_clp > 0),
  flow_order bigint,
  token varchar(200) UNIQUE,
  checkout_url text,
  return_state_hash varchar(64) NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'starting'
    CHECK (state IN ('starting','created','pending','paid','failed','review')),
  provider_status smallint CHECK (provider_status IN (1,2,3,4)),
  payment_method varchar(80),
  confirmed_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_reconciled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mode,credential_id,flow_order)
);
CREATE INDEX IF NOT EXISTS flow_reconciliation ON flow_checkouts(last_reconciled_at,created_at);
