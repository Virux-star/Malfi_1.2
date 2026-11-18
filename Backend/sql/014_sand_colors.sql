ALTER TABLE products
  ADD COLUMN sand_colors text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT product_sand_colors_count CHECK (cardinality(sand_colors) <= 20);

ALTER TABLE order_items
  ADD COLUMN selected_sand_color varchar(60);
