/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { emailAutomationPendingApprovals, inboundEmails } from '../db/schema.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { isCalendarInvite } from './emailContentExtraction.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  GOOGLE_INVITE_START,
  GOOGLE_INVITE_SUBJECT,
  googleCalendarInvite,
} from './__fixtures__/googleCalendarInvite.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

// What the LLM returned in prod for the invite.
const inviteShape: EmailClassificationResult = {
  classification: 'Scheduling',
  classificationConfidence: 95,
  companyName: 'Talentfirm',
  positionTitle: null,
  recruiterName: 'Alex Rivera',
  requiresResponse: true,
  suggestedAction: 'Confirm attendance for the meeting on November 13, 2026.',
  actionDueAt: null,
  interviewDetected: false,
  interviewDatetime: null,
  aiSummary: 'A meeting with Alex Rivera is scheduled for Nov 13.',
};

async function process(subject: string, textBody: string, shape: EmailClassificationResult) {
  jest.mocked(engine.classifyInboundEmailWithLlm).mockResolvedValue(shape);
  const db = createTestDb();
  const userId = seedTestUser(db, { email: 'steve@terapak.com' });
  const id = seedInboundEmail(db, {
    id: 'email-invite',
    fromEmail: 'steve@terapak.com',
    toEmail: 'jobinfo@jobs.example',
    subject,
    payload: JSON.stringify({ FromName: 'Steve Terapak', TextBody: textBody }),
  });
  await processInboundEmail(db, id, { userId });
  const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).all()[0];
  const replies = db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(eq(emailAutomationPendingApprovals.approvalType, 'draft_reply'))
    .all();
  return { row, replies };
}

describe('a forwarded Google Calendar invite', () => {
  it('records the meeting time from the invite', async () => {
    const { row } = await process(GOOGLE_INVITE_SUBJECT, googleCalendarInvite, inviteShape);
    expect(row.interviewDatetime).toBe(GOOGLE_INVITE_START);
  });

  it('does not ask for a reply', async () => {
    const { replies } = await process(GOOGLE_INVITE_SUBJECT, googleCalendarInvite, inviteShape);
    expect(replies).toHaveLength(0);
  });
});

describe('a scheduling email that offers times (control)', () => {
  const offer = `Hi Steve,

Which of these times works for you for a call: Tue Nov 17, 2026 at 2:00pm PST or Wed Nov 18, 2026 at 10:00am PST?

Thanks,
Alex`;

  it('still asks for a reply and books no time', async () => {
    const { row, replies } = await process('Times for our call', offer, {
      ...inviteShape,
      suggestedAction: 'Reply with the time that works',
    });
    expect(row.interviewDatetime).toBeNull();
    expect(replies).toHaveLength(1);
  });
});

describe('isCalendarInvite', () => {
  it('recognises Google, Calendly and accepted invites', () => {
    expect(isCalendarInvite({ subject: 'Invitation: A and B @ Fri Nov 13, 2026 10am', textBody: '' })).toBe(true);
    expect(isCalendarInvite({ subject: 'Updated invitation: A and B', textBody: '' })).toBe(true);
    expect(isCalendarInvite({ subject: 'Re: call', textBody: 'Details\nSent by Google Calendar<https://calendar.google.com/>' })).toBe(true);
    expect(isCalendarInvite({ subject: 'New Event: Steve Terapak', textBody: 'Powered by Calendly.com' })).toBe(true);
  });

  it('is false for an ordinary email', () => {
    expect(isCalendarInvite({ subject: 'Invitation to apply', textBody: 'We invite you to apply.' })).toBe(false);
    expect(isCalendarInvite({ subject: 'Times for our call', textBody: 'Which time works?' })).toBe(false);
  });
});
