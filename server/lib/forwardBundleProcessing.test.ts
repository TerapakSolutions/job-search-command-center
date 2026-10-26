/** @jest-environment node */
import { applications, inboundEmails } from '../db/schema.js';
import {
  listPendingApprovalsForUser,
  resolvePendingApproval,
} from './emailAutomationService.js';
import { APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD } from './__fixtures__/appleMailThreeForwardBundle.js';
import { splitForwardBundle } from './forwardBundleSplitter.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { saveInboundEmail } from './postmarkInbound.js';
import { createTestDb, seedTestUser } from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual('./emailClassificationEngine.js') as typeof import('./emailClassificationEngine.js');
  return {
    classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
    classifyInboundEmailWithRules: actual.classifyInboundEmailWithRules,
  };
});

describe('Apple Mail multi-message forward, end to end', () => {
  it('processes each confirmation as its own email', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const ids: string[] = [];
    for (const part of splitForwardBundle(APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD)) {
      ids.push(await saveInboundEmail(db, part));
    }
    for (const id of ids) {
      const result = await processInboundEmail(db, id, { userId, manual: true });
      expect(result.processingStatus).toBe('processed');
    }

    const rows = db.select().from(inboundEmails).all();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.processingStatus).toBe('processed');
      expect(row.isForwarded).toBe(true);
      expect(row.originalSenderEmail).toBe('no-reply@ashbyhq.com');
      expect(row.companyName).toBe('Acme');
    }
  });
});

describe('Apple Mail multi-message forward of 3 application confirmations', () => {
  it('ends with 3 separate applied applications once approvals are resolved', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    for (const part of splitForwardBundle(APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD)) {
      const id = await saveInboundEmail(db, part);
      await processInboundEmail(db, id, { userId, manual: true });
      for (const approval of listPendingApprovalsForUser(db, userId)) {
        resolvePendingApproval(db, userId, approval.id, 'approved');
      }
    }

    const rows = db.select().from(inboundEmails).all();
    expect(rows.map((r) => r.classification)).toEqual([
      'Application Confirmation',
      'Application Confirmation',
      'Application Confirmation',
    ]);

    const apps = db.select().from(applications).all();
    expect(apps).toHaveLength(3);
    expect(apps.every((a) => a.status === 'applied')).toBe(true);
    expect(new Set(apps.map((a) => a.roleTitle))).toEqual(
      new Set(['Role One', 'Role Two', 'Role Three']),
    );
  });
});

describe('applied date of a forwarded confirmation', () => {
  it('uses the original email date, not the day it was forwarded', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const id = await saveInboundEmail(db, {
      Subject: 'Fwd: Thank you for applying to Acme!',
      FromFull: { Email: 'seeker@example.com' },
      OriginalRecipient: 'seeker@example.com',
      MessageID: 'dated-1',
      Date: 'Mon, 26 Oct 2026 20:38:27 +0000',
      TextBody:
        "Begin forwarded message:\n\nFrom: Acme Hiring <no-reply@ashbyhq.com>\nSubject: Thank you for applying to Acme!\nDate: October 21, 2026 at 8:20:08 AM PDT\nTo: seeker@example.com\n\nHi Alex,\n\nWe've received your application for the Platform Engineer role at Acme!",
    });
    await processInboundEmail(db, id, { userId, manual: true });
    for (const approval of listPendingApprovalsForUser(db, userId)) {
      resolvePendingApproval(db, userId, approval.id, 'approved');
    }

    const apps = db.select().from(applications).all();
    expect(apps).toHaveLength(1);
    expect(apps[0].dateApplied).toBe('2026-10-21');
  });
});
