-- Retention must seek by time, not scan every retained check each minute.
CREATE INDEX checks_time ON checks(checked_at);

-- Maintain aggregates at write time instead of scanning 90 days on every view.
CREATE TABLE check_buckets (
  interval_ms INTEGER NOT NULL,
  monitor_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  successful INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (interval_ms, monitor_id, bucket)
);
CREATE INDEX check_buckets_time ON check_buckets(interval_ms, bucket);

-- Only two distinct minutes per monitor are needed for alert confirmation.
CREATE TABLE monitor_recent_minutes (
  monitor_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  latest_check_id INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, bucket)
);
CREATE INDEX monitor_recent_minutes_latest ON monitor_recent_minutes(monitor_id, latest_check_id DESC);

CREATE TABLE monitor_latest_check (
  monitor_id TEXT PRIMARY KEY,
  latest_check_id INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER NOT NULL,
  error TEXT
);

-- One-time backfill preserves existing charts and alert confirmation history.
INSERT INTO check_buckets
SELECT intervals.interval_ms, c.monitor_id,
  CAST(c.checked_at / intervals.interval_ms AS INTEGER),
  SUM(c.ok), COUNT(*)
FROM checks c
CROSS JOIN (
  SELECT 60000 AS interval_ms UNION ALL SELECT 3600000 UNION ALL SELECT 86400000
) intervals
WHERE CAST(c.checked_at / intervals.interval_ms AS INTEGER) >=
  CAST(unixepoch() * 1000 / intervals.interval_ms AS INTEGER) -
  CASE WHEN intervals.interval_ms = 86400000 THEN 91 ELSE 90 END
GROUP BY intervals.interval_ms, c.monitor_id,
  CAST(c.checked_at / intervals.interval_ms AS INTEGER);

-- SQLite's single MAX aggregate selects c.ok from the row with the maximum id.
INSERT INTO monitor_recent_minutes
SELECT monitor_id, bucket, latest_check_id, ok
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY monitor_id ORDER BY latest_check_id DESC
  ) AS position
  FROM (
    SELECT monitor_id, CAST(checked_at / 60000 AS INTEGER) AS bucket,
      MAX(id) AS latest_check_id, ok
    FROM checks GROUP BY monitor_id, bucket
  )
) WHERE position <= 2;

INSERT INTO monitor_latest_check
SELECT c.monitor_id, c.id, c.checked_at, c.ok, c.status_code, c.latency_ms, c.error
FROM checks c
INNER JOIN (
  SELECT monitor_id, MAX(id) AS id FROM checks GROUP BY monitor_id
) latest ON latest.id = c.id;

-- The Worker replaces this single latest row per check. All persistence happens
-- atomically: keep raw failures, aggregate successes, and retain two alert minutes.
CREATE TRIGGER latest_check_insert AFTER INSERT ON monitor_latest_check
BEGIN
  INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error)
  SELECT NEW.monitor_id, NEW.checked_at, NEW.ok, NEW.status_code, NEW.latency_ms, NEW.error
  WHERE NEW.ok = 0;

  INSERT INTO check_buckets
    (interval_ms, monitor_id, bucket, successful, total)
  SELECT interval_ms, NEW.monitor_id, CAST(NEW.checked_at / interval_ms AS INTEGER),
    NEW.ok, 1
  FROM (
    SELECT 60000 AS interval_ms UNION ALL SELECT 3600000 UNION ALL SELECT 86400000
  ) WHERE true
  ON CONFLICT (interval_ms, monitor_id, bucket) DO UPDATE SET
    successful = successful + excluded.successful,
    total = total + 1;

  INSERT INTO monitor_recent_minutes (monitor_id, bucket, latest_check_id, ok)
  VALUES (NEW.monitor_id, CAST(NEW.checked_at / 60000 AS INTEGER), NEW.latest_check_id, NEW.ok)
  ON CONFLICT (monitor_id, bucket) DO UPDATE SET
    latest_check_id = excluded.latest_check_id,
    ok = excluded.ok;

  DELETE FROM monitor_recent_minutes
  WHERE monitor_id = NEW.monitor_id AND bucket NOT IN (
    SELECT bucket FROM monitor_recent_minutes
    WHERE monitor_id = NEW.monitor_id ORDER BY latest_check_id DESC LIMIT 2
  );
END;

-- Backfill is complete: reclaim raw success history while retaining failures.
DELETE FROM checks WHERE ok = 1;
