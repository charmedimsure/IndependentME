-- FCM device tokens for native full-screen calls. Additive and safe.
CREATE TABLE IF NOT EXISTS fcm_tokens (
  code    TEXT NOT NULL,
  person  TEXT NOT NULL,
  token   TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (code, token)
);
CREATE INDEX IF NOT EXISTS idx_fcm_person ON fcm_tokens (code, person);
