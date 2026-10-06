/// <reference types="node" />

import { describe, expect, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = (name: string) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

const makeDatabase = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_initial.sql"));
  db.exec(migration("0002_alerts.sql"));
  return db;
};

const insert = (db: DatabaseSync, monitor: string, time: number, ok: number) =>
  db
    .prepare(`INSERT INTO checks (monitor_id, checked_at, ok, latency_ms)
      VALUES (?, ?, ?, 1)`)
    .run(monitor, time, ok);

const record = (db: DatabaseSync, monitor: string, time: number, ok: number) =>
  db
    .prepare(`INSERT OR REPLACE INTO monitor_latest_check
    (monitor_id, latest_check_id, checked_at, ok, latency_ms)
    VALUES (?, COALESCE((SELECT latest_check_id + 1 FROM monitor_latest_check
      WHERE monitor_id = ?), 1), ?, ?, 1)`)
    .run(monitor, monitor, time, ok);

const recentMinutes = (db: DatabaseSync, monitor: string) =>
  db
    .prepare(`SELECT ok FROM monitor_recent_minutes
      WHERE monitor_id = ?
      ORDER BY latest_check_id DESC LIMIT 2`)
    .all(monitor);

describe("read-cost migration", () => {
  it("removes historical raw successes after backfill without losing status or failures", () => {
    const db = makeDatabase();
    try {
      const now = Math.floor(Date.now() / 60000) * 60000;
      insert(db, "a", now - 60000, 0);
      insert(db, "a", now, 1);
      insert(db, "b", now, 1);
      insert(db, "c", now, 0);
      const failures = db
        .prepare("SELECT * FROM checks WHERE ok = 0 ORDER BY id")
        .all();
      db.exec(migration("0003_read_costs.sql"));

      expect(db.prepare("SELECT * FROM checks ORDER BY id").all()).toEqual(
        failures,
      );
      expect(recentMinutes(db, "a")).toEqual([{ ok: 1 }, { ok: 0 }]);
      expect(
        db
          .prepare(
            "SELECT ok, checked_at FROM monitor_latest_check WHERE monitor_id = 'b'",
          )
          .get(),
      ).toEqual({ ok: 1, checked_at: now });
      record(db, "b", now + 60000, 1);
      expect(db.prepare("SELECT * FROM checks ORDER BY id").all()).toEqual(
        failures,
      );
      record(db, "b", now + 120000, 0);
      expect(db.prepare("SELECT COUNT(*) AS total FROM checks").get()).toEqual({
        total: 3,
      });
    } finally {
      db.close();
    }
  });

  it("preserves existing chart counts and latest check details during backfill", () => {
    const db = makeDatabase();
    try {
      const now = Math.floor(Date.now() / 60000) * 60000;
      insert(db, "a", now - 2 * 86400000, 1);
      insert(db, "a", now - 60000, 0);
      insert(db, "a", now, 1);
      insert(db, "b", now, 0);
      const expected = [60000, 3600000, 86400000].map((interval) =>
        db
          .prepare(`SELECT monitor_id, CAST(checked_at / ? AS INTEGER) AS bucket,
          SUM(ok) AS successful, COUNT(*) AS total FROM checks
          WHERE CAST(checked_at / ? AS INTEGER) >=
            CAST(unixepoch() * 1000 / ? AS INTEGER) - ?
          GROUP BY monitor_id, bucket ORDER BY monitor_id, bucket`)
          .all(interval, interval, interval, interval === 86400000 ? 91 : 90),
      );
      db.exec(migration("0003_read_costs.sql"));
      [60000, 3600000, 86400000].forEach((interval, index) => {
        expect(
          db
            .prepare(`SELECT monitor_id, bucket, successful, total
          FROM check_buckets WHERE interval_ms = ? ORDER BY monitor_id, bucket`)
            .all(interval),
        ).toEqual(expected[index]);
      });
      expect(
        db
          .prepare(
            "SELECT ok, checked_at FROM monitor_latest_check WHERE monitor_id = 'a'",
          )
          .get(),
      ).toEqual({ ok: 1, checked_at: now });
    } finally {
      db.close();
    }
  });

  it("stores no raw successes and keeps alert state bounded", () => {
    const db = makeDatabase();
    try {
      db.exec(migration("0003_read_costs.sql"));
      for (let minute = 1; minute <= 100; minute++) {
        record(db, "a", minute * 60000, 1);
      }
      expect(db.prepare("SELECT COUNT(*) AS total FROM checks").get()).toEqual({
        total: 0,
      });
      expect(
        db.prepare("SELECT COUNT(*) AS total FROM monitor_latest_check").get(),
      ).toEqual({ total: 1 });
      expect(
        db
          .prepare("SELECT COUNT(*) AS total FROM monitor_recent_minutes")
          .get(),
      ).toEqual({ total: 2 });
      expect(
        db
          .prepare(
            "SELECT successful, total FROM check_buckets WHERE interval_ms = 86400000",
          )
          .get(),
      ).toEqual({ successful: 100, total: 100 });
      record(db, "a", 101 * 60000, 0);
      expect(db.prepare("SELECT ok, checked_at FROM checks").all()).toEqual([
        { ok: 0, checked_at: 101 * 60000 },
      ]);
      expect(recentMinutes(db, "a")).toEqual([{ ok: 0 }, { ok: 1 }]);
    } finally {
      db.close();
    }
  });

  it("backfills history and atomically aggregates new checks", () => {
    const db = makeDatabase();
    try {
      insert(db, "a", 60000, 1);
      insert(db, "a", 60001, 0);
      insert(db, "a", 120000, 0);
      insert(db, "b", 120000, 1);
      db.exec(migration("0003_read_costs.sql"));
      expect(recentMinutes(db, "a")).toEqual([{ ok: 0 }, { ok: 0 }]);

      record(db, "a", 120001, 1);
      expect(recentMinutes(db, "a")).toEqual([{ ok: 1 }, { ok: 0 }]);

      // Use current timestamps for chart backfill; old data is intentionally pruned.
      const now = Math.floor(Date.now() / 60000) * 60000;
      record(db, "a", now, 1);
      record(db, "a", now + 1, 0);
      record(db, "a", now + 60000, 1);
      for (const interval of [60000, 3600000, 86400000]) {
        const raw = db
          .prepare(`SELECT 'a' AS monitor_id, CAST(time / ? AS INTEGER) AS bucket,
            SUM(ok) AS successful, COUNT(*) AS total FROM (
              SELECT ? AS time, 1 AS ok UNION ALL SELECT ?, 0 UNION ALL SELECT ?, 1
            ) GROUP BY bucket ORDER BY bucket`)
          .all(interval, now, now + 1, now + 60000);
        const buckets = db
          .prepare(`SELECT monitor_id, bucket, successful, total FROM check_buckets
            WHERE interval_ms = ? AND bucket >= ? ORDER BY monitor_id, bucket`)
          .all(interval, Math.floor(now / interval));
        expect(buckets).toEqual(raw);
      }

      const before = recentMinutes(db, "a");
      db.exec("BEGIN");
      record(db, "a", now + 120000, 0);
      db.exec("ROLLBACK");
      expect(recentMinutes(db, "a")).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS total FROM checks").get()).toEqual({
        total: 3,
      });
      expect(
        db
          .prepare(
            "SELECT ok, checked_at FROM monitor_latest_check WHERE monitor_id = 'a'",
          )
          .get(),
      ).toEqual({ ok: 1, checked_at: now + 60000 });
    } finally {
      db.close();
    }
  });

  it("preserves latest-per-minute semantics for duplicates, gaps and out-of-order checks", () => {
    const db = makeDatabase();
    try {
      insert(db, "a", 60000, 0);
      insert(db, "a", 60001, 1);
      insert(db, "a", 600000, 0);
      insert(db, "a", 120000, 1);
      const original = () =>
        db
          .prepare(`SELECT c.ok FROM checks c INNER JOIN (
        SELECT MAX(id) AS id FROM checks WHERE monitor_id = 'a'
        GROUP BY CAST(checked_at / 60000 AS INTEGER)
        ORDER BY id DESC LIMIT 2
      ) latest ON latest.id = c.id ORDER BY c.id DESC`)
          .all();
      const expected = original();
      db.exec(migration("0003_read_costs.sql"));
      expect(recentMinutes(db, "a")).toEqual(expected);
      record(db, "a", 60002, 0);
      expect(recentMinutes(db, "a")).toEqual([{ ok: 0 }, { ok: 1 }]);
      expect(recentMinutes(db, "missing")).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS total FROM monitor_recent_minutes WHERE monitor_id = 'a'",
          )
          .get(),
      ).toEqual({ total: 2 });
    } finally {
      db.close();
    }
  });

  it("uses indexed searches rather than full-history scans or sorting", () => {
    const db = makeDatabase();
    try {
      db.exec(migration("0003_read_costs.sql"));
      const queries = [
        ["DELETE FROM checks WHERE checked_at < 1000", "checks_time"],
        [
          `SELECT ok FROM monitor_recent_minutes
          WHERE monitor_id = 'a'
          ORDER BY latest_check_id DESC LIMIT 2`,
          "monitor_recent_minutes_latest",
        ],
        [
          `SELECT monitor_id, bucket, successful, total FROM check_buckets
          WHERE interval_ms = 86400000 AND bucket >= 1000`,
          "check_buckets_time",
        ],
        [
          `DELETE FROM check_buckets WHERE interval_ms = 60000 AND bucket < 1000`,
          "check_buckets_time",
        ],
      ];
      for (const [query, index] of queries) {
        const plan = JSON.stringify(
          db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(),
        );
        expect(plan).toContain(index);
        expect(plan).toContain("SEARCH");
        expect(plan).not.toContain("SCAN");
        expect(plan).not.toContain("TEMP B-TREE");
      }
    } finally {
      db.close();
    }
  });
});
