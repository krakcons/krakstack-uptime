CREATE TABLE monitor_alert_state (
  monitor_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE alert_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX alert_outbox_pending ON alert_outbox(sent_at, created_at);
