/** @jest-environment node */
import { applications, contacts, emailAutomationPendingApprovals } from '../db/schema.js';
import { parseClassificationJson } from './emailClassificationParser.js';
import { listInboundEmailsForUser } from './inboundEmailService.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { classifyInboundEmailWithLlm } from './emailClassificationEngine.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual('./emailClassificationEngine.js') as typeof import('./emailClassificationEngine.js');
  return {
    classifyInboundEmailWithLlm: jest.fn(),
    classifyInboundEmailWithRules: actual.classifyInboundEmailWithRules,
  };
});

// Real shape (prod, 2026-10-26): a loan "payment is due soon" reminder rode
// along in a batch forward of job emails.
const BILL_BODY =
  'Begin forwarded message:\n\nFrom: Service Finance Company <noreply@svcfin.example>\nSubject: A payment is due soon.\nDate: October 20, 2026 at 9:00:00 AM PDT\nTo: seeker@example.com\n\nYour payment of $120.00 is due on 11/01. Log in to pay.';

describe('Not Job Related emails', () => {
  it('accepts the classification from the model', () => {
    const parsed = parseClassificationJson(
      JSON.stringify({ classification: 'Not Job Related', classificationConfidence: 97 }),
    );
    expect(parsed?.classification).toBe('Not Job Related');
  });

  it('creates no application, contact or approval for a non-job email', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    (classifyInboundEmailWithLlm as jest.Mock).mockResolvedValue({
      classification: 'Not Job Related',
      classificationConfidence: 97,
      companyName: 'Service Finance Company',
      positionTitle: null,
      recruiterName: null,
      requiresResponse: true,
      suggestedAction: 'Pay the bill',
      actionDueAt: null,
      interviewDetected: false,
      interviewDatetime: null,
      aiSummary: 'A loan payment reminder.',
    });
    const id = seedInboundEmail(db, {
      toEmail: 'seeker@example.com',
      fromEmail: 'seeker@example.com',
      subject: 'Fwd: A payment is due soon.',
      payload: JSON.stringify({ TextBody: BILL_BODY }),
    });

    await processInboundEmail(db, id, { userId, manual: true });

    expect(db.select().from(applications).all()).toHaveLength(0);
    expect(db.select().from(contacts).all()).toHaveLength(0);
    expect(db.select().from(emailAutomationPendingApprovals).all()).toHaveLength(0);
  });

  it('hides them from the inbound list by default and says how many', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    seedInboundEmail(db, { id: 'job', toEmail: 'seeker@example.com', classification: 'Recruiter Outreach' });
    seedInboundEmail(db, { id: 'other', toEmail: 'seeker@example.com', classification: 'Other' });
    seedInboundEmail(db, { id: 'bill', toEmail: 'seeker@example.com', classification: 'Not Job Related' });

    const visible = listInboundEmailsForUser(db, userId);
    expect(visible.items.map((e) => e.id).sort()).toEqual(['job', 'other']);
    expect(visible.hiddenCount).toBe(1);

    const all = listInboundEmailsForUser(db, userId, { includeNotJobRelated: true });
    expect(all.items.map((e) => e.id).sort()).toEqual(['bill', 'job', 'other']);
    expect(all.hiddenCount).toBe(0);
  });
});
