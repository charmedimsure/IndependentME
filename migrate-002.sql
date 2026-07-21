-- Additive only. Safe to run on a live database; nothing is dropped.
-- Keeps the previous setup so a bad write can always be undone.
ALTER TABLE household ADD COLUMN prev_config TEXT;
ALTER TABLE household ADD COLUMN prev_updated INTEGER;
