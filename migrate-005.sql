-- Adds a recipient field so caregivers can message each other, not just Karelynn.
-- Additive and safe to run on a live database.
ALTER TABLE messages ADD COLUMN toname TEXT;
