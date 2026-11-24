/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS = path.join(process.cwd(), 'server', 'db', 'migrations');

/**
 * 0019 only ADDS three nullable columns to `contacts`. Prod has 0000–0018 and real
 * contact rows, which must come through unchanged with every new column NULL.
 */
it('0019_contact_thread_close adds three nullable columns and changes no rows', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscc-migrations-'));
  try {
    const before = path.join(tmp, 'migrations');
    fs.cpSync(MIGRATIONS, before, { recursive: true });
    const journalPath = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 18);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: before });
    // Invented user and contact.
    sqlite
      .prepare(
        `INSERT INTO users (id, google_id, email, name, avatar_url, created_at, updated_at)
         VALUES ('u-1', 'g-1', 'pella@example.test', 'Pella Wren', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, user_id, name, email, last_contact_date, created_at, updated_at)
         VALUES ('c-1', 'u-1', 'Maya Lund', 'maya.lund@vendor-a.example', '2026-11-10', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z')`,
      )
      .run();
    const cols = () =>
      sqlite.prepare(`PRAGMA table_info('contacts')`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    expect(cols().some((c) => c.name === 'decline_detected_at' || c.name === 'thread_closed_at')).toBe(false);
    const rowsBefore = sqlite.prepare(`SELECT * FROM contacts`).all() as Array<Record<string, unknown>>;

    migrate(db, { migrationsFolder: MIGRATIONS });
    for (const name of ['decline_detected_at', 'thread_closed_at', 'thread_kept_open_at']) {
      const col = cols().find((c) => c.name === name);
      expect({ name, notnull: col?.notnull, dflt: col?.dflt_value }).toEqual({ name, notnull: 0, dflt: null });
    }
    expect(sqlite.prepare(`SELECT * FROM contacts`).all()).toEqual(
      rowsBefore.map((r) => ({ ...r, decline_detected_at: null, thread_closed_at: null, thread_kept_open_at: null })),
    );
    sqlite.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
