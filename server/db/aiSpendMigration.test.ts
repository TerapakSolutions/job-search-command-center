/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS = path.join(process.cwd(), 'server', 'db', 'migrations');

/**
 * 0018 only CREATES a table: prod has 0000–0017 and real rows, which must come
 * through byte-for-byte unchanged. Starts from the prod shape (see
 * feedbackMigration.test.ts for why a fresh-DB test is not enough).
 */
it('0018_ai_spend_daily adds a table and changes no existing rows', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscc-migrations-'));
  try {
    const before = path.join(tmp, 'migrations');
    fs.cpSync(MIGRATIONS, before, { recursive: true });
    const journalPath = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 17);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: before });
    // Invented user and report.
    sqlite
      .prepare(
        `INSERT INTO users (id, google_id, email, name, avatar_url, created_at, updated_at, follow_up_after_days)
         VALUES ('u-1', 'g-1', 'pella@example.test', 'Pella Wren', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 5)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO feedback (id, user_id, user_email, message, created_at)
         VALUES ('f-1', 'u-1', 'pella@example.test', 'The button is grey', '2026-01-03T00:00:00.000Z')`,
      )
      .run();
    const hasTable = () =>
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ai_spend_daily'`).all().length;
    expect(hasTable()).toBe(0);
    const usersBefore = sqlite.prepare(`SELECT * FROM users`).all();
    const feedbackBefore = sqlite.prepare(`SELECT * FROM feedback`).all();

    migrate(db, { migrationsFolder: MIGRATIONS });
    expect(hasTable()).toBe(1);
    expect(sqlite.prepare(`SELECT * FROM users`).all()).toEqual(usersBefore);
    expect(sqlite.prepare(`SELECT * FROM feedback`).all()).toEqual(feedbackBefore);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ai_spend_daily`).get()).toEqual({ n: 0 });
    sqlite.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
