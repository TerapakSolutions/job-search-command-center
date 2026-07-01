import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import * as schema from '../db/schema.js';
import { createId } from './id.js';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'server', 'db', 'migrations'),
  });
  return db;
}

export function seedTestUser(db: ReturnType<typeof createTestDb>, overrides: Partial<{
  id: string;
  email: string;
  name: string;
}> = {}) {
  const id = overrides.id ?? 'user-test-1';
  const timestamp = '2026-07-01T00:00:00.000Z';
  db.insert(schema.users)
    .values({
      id,
      googleId: `google-${id}`,
      email: overrides.email ?? 'seeker@example.com',
      name: overrides.name ?? 'Test User',
      avatarUrl: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

export function seedApplication(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  overrides: Partial<typeof schema.applications.$inferInsert> = {},
) {
  const id = overrides.id ?? 'app-1';
  const timestamp = overrides.createdAt ?? '2026-07-01T00:00:00.000Z';
  db.insert(schema.applications)
    .values({
      id,
      userId,
      company: overrides.company ?? 'Acme Corp',
      roleTitle: overrides.roleTitle ?? 'Engineer',
      jobUrl: '',
      workLocationType: 'remote',
      location: '',
      salaryMin: null,
      salaryMax: null,
      dateApplied: overrides.dateApplied ?? null,
      status: overrides.status ?? 'applied',
      notes: '',
      interviewDate: overrides.interviewDate ?? null,
      createdAt: timestamp,
      updatedAt: overrides.updatedAt ?? timestamp,
    })
    .run();
  return id;
}

export function seedInboundEmail(
  db: ReturnType<typeof createTestDb>,
  overrides: Partial<typeof schema.inboundEmails.$inferInsert> = {},
) {
  const id = overrides.id ?? createId();
  const timestamp = overrides.createdAt ?? '2026-07-01T00:00:00.000Z';
  db.insert(schema.inboundEmails)
    .values({
      id,
      provider: overrides.provider ?? 'postmark',
      subject: overrides.subject ?? 'Test subject',
      fromEmail: overrides.fromEmail ?? 'recruiter@acme.com',
      toEmail: overrides.toEmail ?? 'seeker@example.com',
      receivedAt: overrides.receivedAt ?? '2026-07-01T09:00:00.000Z',
      payload:
        overrides.payload ??
        JSON.stringify({
          Subject: overrides.subject ?? 'Test subject',
          TextBody: 'Hello from recruiter',
          HtmlBody: '<p>Hello from recruiter</p>',
        }),
      processed: overrides.processed ?? false,
      createdAt: timestamp,
      updatedAt: overrides.updatedAt ?? timestamp,
    })
    .run();
  return id;
}
