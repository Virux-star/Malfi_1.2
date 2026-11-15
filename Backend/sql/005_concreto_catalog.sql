-- Rename the material in the current catalog, preserving inventory and order snapshots.
UPDATE products
SET category = regexp_replace(regexp_replace(regexp_replace(category,
      '\mCEMENTO\M', 'CONCRETO', 'g'), '\mCemento\M', 'Concreto', 'g'), '\mcemento\M', 'concreto', 'gi'),
    name = regexp_replace(regexp_replace(regexp_replace(name,
      '\mCEMENTO\M', 'CONCRETO', 'g'), '\mCemento\M', 'Concreto', 'g'), '\mcemento\M', 'concreto', 'gi'),
    description = regexp_replace(regexp_replace(regexp_replace(description,
      '\mCEMENTO\M', 'CONCRETO', 'g'), '\mCemento\M', 'Concreto', 'g'), '\mcemento\M', 'concreto', 'gi')
WHERE category ~* '\mcemento\M'
   OR name ~* '\mcemento\M'
   OR description ~* '\mcemento\M';
