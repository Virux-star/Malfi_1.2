ALTER TABLE products
  ADD COLUMN colors text[] NOT NULL DEFAULT '{}',
  ADD COLUMN aromas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN image_gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT product_colors_count CHECK (cardinality(colors) <= 20),
  ADD CONSTRAINT product_aromas_count CHECK (cardinality(aromas) <= 20),
  ADD CONSTRAINT product_gallery_shape CHECK (jsonb_typeof(image_gallery) = 'array' AND jsonb_array_length(image_gallery) <= 6);

UPDATE products
SET image_gallery = jsonb_build_array(jsonb_build_object('url', image_url, 'public_id', image_public_id))
WHERE image_url IS NOT NULL AND length(trim(image_url)) > 0;

ALTER TABLE order_items
  ADD COLUMN selected_color varchar(60),
  ADD COLUMN selected_aroma varchar(60);
