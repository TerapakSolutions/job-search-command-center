/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { inboundEmails } from '../db/schema.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

const outreach: EmailClassificationResult = {
  classification: 'Recruiter Outreach',
  classificationConfidence: 90,
  companyName: 'Acme Corp',
  positionTitle: 'Platform Lead',
  recruiterName: 'Ravi Kumar',
  requiresResponse: false,
  suggestedAction: 'Review opportunity',
  actionDueAt: null,
  interviewDetected: false,
  interviewDatetime: null,
  aiSummary: 'A recruiter reached out about a Platform Lead role.',
};

function stepMessages(db: ReturnType<typeof createTestDb>, id: string): Record<string, string> {
  const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).all()[0];
  const parsed = JSON.parse(row.processingTimelineJson ?? '{}');
  const steps: Array<{ step: string; message: string }> = parsed.steps ?? parsed;
  return Object.fromEntries(steps.map((s) => [s.step, s.message]));
}

describe('timeline wording when an approval is queued (#89)', () => {
  it('says what is waiting for approval, not just "No matching application"', async () => {
    jest.mocked(engine.classifyInboundEmailWithLlm).mockResolvedValue(outreach);
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const id = seedInboundEmail(db, {
      id: 'email-outreach',
      fromEmail: 'ravi.kumar@acmestaffing.example',
      toEmail: 'seeker@example.com',
      subject: 'Platform Lead at Acme Corp',
      payload: JSON.stringify({ TextBody: 'Hi, I have a Platform Lead role at Acme Corp.' }),
    });

    await processInboundEmail(db, id, { userId });
    const steps = stepMessages(db, id);

    expect(steps.approval_queued).toBe(
      'Queued for your approval: Create application for Acme Corp / Platform Lead',
    );
    expect(steps.safe_actions_applied).toBe('Nothing applied automatically');
  });

  it('lists each waiting item when there is more than one', async () => {
    jest.mocked(engine.classifyInboundEmailWithLlm).mockResolvedValue({ ...outreach, requiresResponse: true });
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const id = seedInboundEmail(db, {
      id: 'email-outreach-2',
      fromEmail: 'ravi.kumar@acmestaffing.example',
      toEmail: 'seeker@example.com',
      subject: 'Platform Lead at Acme Corp',
      payload: JSON.stringify({ TextBody: 'Hi, I have a Platform Lead role at Acme Corp. Can you reply?' }),
    });
    await processInboundEmail(db, id, { userId });
    expect(stepMessages(db, id).approval_queued).toBe(
      'Queued for your approval: Create application for Acme Corp / Platform Lead; Review the suggested reply',
    );
  });
});
