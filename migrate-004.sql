-- Remembers which task reminders have already fired today, so the once-a-minute
-- cron nudges once per stage instead of every minute. Additive and safe.
CREATE TABLE IF NOT EXISTS nudges (
  code TEXT NOT NULL,
  day  TEXT NOT NULL,
  k    TEXT NOT NULL,
  at   INTEGER NOT NULL,
  PRIMARY KEY (code, day, k)
);
