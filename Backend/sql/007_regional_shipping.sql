-- Regional Blue Express prices coexist with legacy commune prices until the owner confirms a regional rate.
ALTER TABLE shipping_rates_comunas ADD COLUMN rate_scope varchar(10) NOT NULL DEFAULT 'comuna'
  CHECK (rate_scope IN ('comuna', 'region'));
ALTER TABLE shipping_rates_comunas ADD CONSTRAINT shipping_rate_scope_destination_check
  CHECK ((rate_scope='region' AND carrier='Blue Express' AND comuna='')
    OR (rate_scope='comuna' AND length(trim(comuna))>0));

-- The owner confirmed a flat customer price of CLP 3,000 for Paket in Santiago.
-- Reuse the previously verified Santiago delivery window; do not invent delivery times.
UPDATE shipping_rates_comunas SET price_clp=3000,updated_at=now() WHERE carrier='Paket';
WITH template AS (
  SELECT max(delivery_days_min) AS days_min,max(delivery_days_max) AS days_max,
    count(*)>0 AS enabled
  FROM shipping_rates_comunas
  WHERE carrier='Paket' AND region='Metropolitana de Santiago' AND active=TRUE
    AND verified_at IS NOT NULL AND delivery_days_min>=1 AND delivery_days_max>=delivery_days_min
), coverage(comuna) AS (VALUES
  ('Cerrillos'),
  ('Cerro Navia'),
  ('Conchalí'),
  ('El Bosque'),
  ('Estación Central'),
  ('Huechuraba'),
  ('Independencia'),
  ('La Cisterna'),
  ('La Florida'),
  ('La Granja'),
  ('La Pintana'),
  ('La Reina'),
  ('Las Condes'),
  ('Lo Barnechea'),
  ('Lo Espejo'),
  ('Lo Prado'),
  ('Macul'),
  ('Maipú'),
  ('Ñuñoa'),
  ('Pedro Aguirre Cerda'),
  ('Peñalolén'),
  ('Providencia'),
  ('Pudahuel'),
  ('Puente Alto'),
  ('Quilicura'),
  ('Quinta Normal'),
  ('Recoleta'),
  ('Renca'),
  ('San Bernardo'),
  ('San Joaquín'),
  ('San Miguel'),
  ('San Ramón'),
  ('Santiago'),
  ('Vitacura')
)
INSERT INTO shipping_rates_comunas(region,comuna,carrier,price_clp,active,delivery_days_min,delivery_days_max,santiago_coverage,verified_at,rate_scope)
SELECT 'Metropolitana de Santiago',coverage.comuna,'Paket',3000,template.enabled,
  template.days_min,template.days_max,TRUE,CASE WHEN template.enabled THEN now() ELSE NULL END,'comuna'
FROM coverage CROSS JOIN template
ON CONFLICT (lower(trim(region)),lower(trim(comuna))) DO UPDATE SET
  carrier='Paket',price_clp=3000,active=excluded.active,
  delivery_days_min=excluded.delivery_days_min,delivery_days_max=excluded.delivery_days_max,
  santiago_coverage=TRUE,verified_at=excluded.verified_at,rate_scope='comuna',updated_at=now();
