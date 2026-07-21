-- IndependentME · D1 schema

DROP TABLE IF EXISTS household;
DROP TABLE IF EXISTS log;
DROP TABLE IF EXISTS messages;

CREATE TABLE household (
  code    TEXT PRIMARY KEY,   -- household code, shared by both apps
  care    TEXT,               -- caregiver key, required for writes
  config  TEXT,               -- JSON: name, tasks, contacts, phrases, ntfy topic
  updated INTEGER
);

CREATE TABLE log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT NOT NULL,
  day     TEXT NOT NULL,      -- YYYY-MM-DD in the tablet's local time
  task_id TEXT NOT NULL,
  at      INTEGER NOT NULL,   -- epoch ms when it was checked off
  UNIQUE(code, day, task_id)
);
CREATE INDEX idx_log_day ON log (code, day);

CREATE TABLE messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT NOT NULL,
  dir       TEXT NOT NULL,    -- 'out' from the tablet, 'in' from a caregiver, 'alert' automatic
  who       TEXT,             -- who she addressed it to, or who replied
  body      TEXT NOT NULL,
  icon      TEXT,
  at        INTEGER NOT NULL,
  seen      INTEGER DEFAULT 0,
  ack       TEXT,             -- name of whoever tapped "I've got this"
  ack_at    INTEGER,
  escalated INTEGER DEFAULT 0 -- 1 once an unanswered help request opened up to everyone
);
CREATE INDEX idx_msg_code ON messages (code, id);

-- Photos she chooses to send when someone asks to check in
CREATE TABLE photos (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  who  TEXT,                  -- who asked
  data TEXT NOT NULL,         -- base64 jpeg
  at   INTEGER NOT NULL,
  seen INTEGER DEFAULT 0
);
CREATE INDEX idx_photo_code ON photos (code, id);

-- Video call setup messages. Rows are short-lived and cleared as calls end.
CREATE TABLE signal (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT NOT NULL,
  room    TEXT NOT NULL,
  side    TEXT NOT NULL,      -- 'a' = whoever started it, 'b' = whoever answered
  kind    TEXT NOT NULL,      -- offer | answer | ice | end
  payload TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX idx_signal_room ON signal (code, room, id);
