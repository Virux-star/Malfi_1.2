ALTER TABLE products
  ADD COLUMN workshop_times text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT product_workshop_times_count CHECK (cardinality(workshop_times) <= 20),
  ADD CONSTRAINT product_workshop_times_category CHECK (category = 'Talleres' OR cardinality(workshop_times) = 0);

ALTER TABLE order_items
  ADD COLUMN selected_workshop_time varchar(60),
  ADD CONSTRAINT order_workshop_time_has_date CHECK (selected_workshop_time IS NULL OR selected_workshop_date IS NOT NULL);
