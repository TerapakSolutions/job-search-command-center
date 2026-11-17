/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS = path.join(process.cwd(), 'server', 'db', 'migrations');

/**
 * Prod already has 0000–0015 applied. Drizzle only runs a migration whose journal
 * `when` is newer than the last applied one, so a fresh-DB test can't catch a
 * 0016 that prod would silently skip. This one starts from the prod shape.
 */
it('0016_feedback applies to a database that already has every earlier migration', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscc-migrations-'));
  try {
    const before = path.join(tmp, 'migrations');
    fs.cpSync(MIGRATIONS, before, { recursive: true });
    const journalPath = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    // Keep exactly 0000–0015: a later migration left in would be applied first and
    // make drizzle skip 0016 as older than the last one applied.
    journal.entries = journal.entries.filter((e) => e.idx <= 15);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: before });
    const hasTable = () =>
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'`).all().length;
    expect(hasTable()).toBe(0);

    migrate(db, { migrationsFolder: MIGRATIONS });
    expect(hasTable()).toBe(1);
    sqlite.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * 0017 only ADDS a nullable column to `users`: prod has 0000–0016 and real user
 * rows, which must come through unchanged with the new column NULL (= default 3).
 */
it('0017_users_follow_up_after_days adds a nullable column and changes no rows', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscc-migrations-'));
  try {
    const before = path.join(tmp, 'migrations');
    fs.cpSync(MIGRATIONS, before, { recursive: true });
    const journalPath = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 16);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: before });
    // Invented user.
    sqlite
      .prepare(
        `INSERT INTO users (id, google_id, email, name, avatar_url, created_at, updated_at)
         VALUES ('u-1', 'g-1', 'pella@example.test', 'Pella Wren', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
      )
      .run();
    const cols = () =>
      (sqlite.prepare(`PRAGMA table_info('users')`).all() as Array<{ name: string; notnull: number }>);
    expect(cols().some((c) => c.name === 'follow_up_after_days')).toBe(false);
    const rowBefore = sqlite.prepare(`SELECT * FROM users`).all();

    migrate(db, { migrationsFolder: MIGRATIONS });
    const col = cols().find((c) => c.name === 'follow_up_after_days');
    expect(col?.notnull).toBe(0);
    const rowsAfter = sqlite.prepare(`SELECT * FROM users`).all() as Array<Record<string, unknown>>;
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter).toEqual(
      (rowBefore as Array<Record<string, unknown>>).map((r) => ({ ...r, follow_up_after_days: null })),
    );
    sqlite.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * 🔴 Drizzle skips any migration whose journal `when` is not newer than the last one applied. Entries from 0012 on
 * use synthetic future values (1.86e12 … 1.90e12), while `drizzle-kit generate` writes `Date.now()` (≈1.79e12 in
 * 2026-11). So a freshly generated migration would pass CI on an empty database and NEVER run in prod. This makes
 * that fail CI instead: give the new entry a `when` above the previous one.
 */
it('every journal entry is strictly newer than the one before it', () => {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string; when: number }> };
  for (let i = 1; i < journal.entries.length; i++) {
    const prev = journal.entries[i - 1];
    const cur = journal.entries[i];
    expect({ tag: cur.tag, newerThanPrevious: cur.when > prev.when }).toEqual({ tag: cur.tag, newerThanPrevious: true });
  }
});
