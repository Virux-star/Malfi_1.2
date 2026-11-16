-- Update the current business contact. Historical order snapshots and queued emails remain unchanged.
UPDATE store_settings
SET value=jsonb_set(value,'{phone}',to_jsonb('+56 9 5633 5519'::text),true),updated_at=now()
WHERE key='business' AND value->>'phone' IS DISTINCT FROM '+56 9 5633 5519';
