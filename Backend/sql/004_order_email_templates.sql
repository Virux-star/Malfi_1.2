-- Existing queued messages retain their original format when retried.
ALTER TABLE order_email_outbox
  ADD COLUMN IF NOT EXISTS template_version smallint NOT NULL DEFAULT 1
  CHECK (template_version IN (1, 2));
