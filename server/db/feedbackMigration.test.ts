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
      entries: Array<{ tag: string }>;
    };
    journal.entries = journal.entries.filter((e) => e.tag !== '0016_feedback');
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    fs.rmSync(path.join(before, '0016_feedback.sql'));

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
