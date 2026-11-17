ALTER TABLE products
  ADD COLUMN workshop_dates text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT product_workshop_dates_count CHECK (cardinality(workshop_dates) <= 20);

-- Text preserves the exact calendar date without PostgreSQL/Node timezone conversion.
ALTER TABLE order_items
  ADD COLUMN selected_workshop_date varchar(10),
  ADD CONSTRAINT order_workshop_date_shape CHECK (
    selected_workshop_date IS NULL OR selected_workshop_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  );
