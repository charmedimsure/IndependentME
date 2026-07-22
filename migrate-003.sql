-- Web Push subscriptions, one row per caregiver device.
-- Additive and safe to run on a live database.
CREATE TABLE IF NOT EXISTS push_subs (
  code     TEXT NOT NULL,
  person   TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  updated  INTEGER NOT NULL,
  PRIMARY KEY (code, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_person ON push_subs (code, person);
