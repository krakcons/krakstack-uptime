CREATE TABLE checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER NOT NULL,
  error TEXT
);

CREATE INDEX checks_monitor_time ON checks(monitor_id, checked_at DESC);
