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
