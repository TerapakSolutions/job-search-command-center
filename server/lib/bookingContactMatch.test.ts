/** @jest-environment node */
import { eq } from 'drizzle-orm';
import {
  applications,
  communications,
  contacts,
  emailAutomationPendingApprovals,
  interviews,
} from '../db/schema.js';
import { matchEmailToApplications } from './emailApplicationMatcher.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  GOOGLE_INVITE_RECRUITER,
  GOOGLE_INVITE_START,
  GOOGLE_INVITE_SUBJECT,
  googleCalendarInvite,
} from './__fixtures__/googleCalendarInvite.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

type Db = ReturnType<typeof createTestDb>;

// What the LLM returned in prod for the invite: the recruiting firm as the
// company, no role, the recruiter's name.
const inviteShape: EmailClassificationResult = {
  classification: 'Scheduling',
  classificationConfidence: 95,
  companyName: 'Talentfirm',
  positionTitle: null,
  recruiterName: GOOGLE_INVITE_RECRUITER,
  requiresResponse: true,
  suggestedAction: 'Confirm attendance for the meeting on November 13, 2026.',
  actionDueAt: null,
  interviewDetected: false,
  interviewDatetime: null,
  aiSummary: 'A meeting with Alex Rivera is scheduled for Nov 13.',
};

function seedContact(db: Db, userId: string, applicationId: string, id: string, name = GOOGLE_INVITE_RECRUITER) {
  db.insert(contacts)
    .values({
      id,
      userId,
      applicationId,
      name,
      // The address from the screening request, not the one the invite came from.
      email: 'alex.rivera@examplegrocer.example',
      company: 'Example Grocer',
      createdAt: '2026-11-11T15:01:00.000Z',
      updatedAt: '2026-11-11T15:01:00.000Z',
    })
    .run();
}

// The state #93's screening request leaves: the application at Recruiter
// Screen with the recruiter saved as a contact.
function setup() {
  const db = createTestDb();
  const userId = seedTestUser(db, { email: 'steve@terapak.com' });
  seedApplication(db, userId, {
    id: 'app-grocer',
    company: 'Example Grocer',
    roleTitle: 'Senior Engineering Manager, DC Buying',
    status: 'recruiter_screen',
  });
  seedApplication(db, userId, { id: 'app-other', company: 'Other Co', roleTitle: 'Director', status: 'applied' });
  seedContact(db, userId, 'app-grocer', 'contact-alex');
  return { db, userId };
}

describe('a forwarded calendar invite from the recruiter of one application', () => {
  it('books the interview on that application and keeps it at Recruiter Screen', async () => {
    jest.mocked(engine.classifyInboundEmailWithLlm).mockResolvedValue(inviteShape);
    const { db, userId } = setup();
    const id = seedInboundEmail(db, {
      id: 'email-invite',
      fromEmail: 'steve@terapak.com',
      toEmail: 'jobinfo@jobs.example',
      subject: GOOGLE_INVITE_SUBJECT,
      payload: JSON.stringify({ FromName: 'Steve Terapak', TextBody: googleCalendarInvite }),
    });

    await processInboundEmail(db, id, { userId });

    const booked = db.select().from(interviews).all();
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ applicationId: 'app-grocer', scheduledAt: GOOGLE_INVITE_START });
    const app = db.select().from(applications).where(eq(applications.id, 'app-grocer')).all()[0];
    expect(app.status).toBe('recruiter_screen');
    expect(app.interviewDate).toBe('2026-11-13');
    expect(
      db
        .select()
        .from(emailAutomationPendingApprovals)
        .where(eq(emailAutomationPendingApprovals.approvalType, 'draft_reply'))
        .all(),
    ).toHaveLength(0);

    // The recruiter stays one contact; the invite is logged on it.
    const saved = db.select().from(contacts).where(eq(contacts.applicationId, 'app-grocer')).all();
    expect(saved).toHaveLength(1);
    expect(saved[0].email).toBe('alex.rivera@examplegrocer.example');
    const comms = db.select().from(communications).where(eq(communications.applicationId, 'app-grocer')).all();
    expect(comms.map((c) => c.contactId)).toEqual(['contact-alex']);
  });
});

describe('matching a booking through a saved contact', () => {
  const input = (overrides: Partial<Parameters<typeof matchEmailToApplications>[2]> = {}) => ({
    inboundEmailId: 'email-x',
    fromEmail: 'alex@talentfirm.example',
    companyName: 'Talentfirm',
    positionTitle: null,
    recruiterName: GOOGLE_INVITE_RECRUITER,
    classification: 'Scheduling',
    subject: 'Invitation: Steve Terapak and Alex Rivera @ Fri Nov 13, 2026 10:15am',
    ...overrides,
  });

  it('matches the one application the recruiter is saved on', () => {
    const { db, userId } = setup();
    const result = matchEmailToApplications(db, userId, input());
    expect(result.bestMatch?.applicationId).toBe('app-grocer');
    expect(result.bestMatch?.matchReasons).toContain('Booking with your contact Alex Rivera');
  });

  it('matches by the name in the subject when no recruiter was extracted', () => {
    const { db, userId } = setup();
    expect(matchEmailToApplications(db, userId, input({ recruiterName: null })).bestMatch?.applicationId).toBe(
      'app-grocer',
    );
  });

  it('does not guess when the recruiter is saved on two applications', () => {
    const { db, userId } = setup();
    seedContact(db, userId, 'app-other', 'contact-alex-2');
    expect(matchEmailToApplications(db, userId, input()).bestMatch).toBeNull();
  });

  it('does not match an unknown name', () => {
    const { db, userId } = setup();
    expect(
      matchEmailToApplications(db, userId, input({ recruiterName: 'Sam Lee', subject: 'Invitation: Steve and Sam Lee' }))
        .bestMatch,
    ).toBeNull();
  });

  it('only applies to bookings and interview requests', () => {
    const { db, userId } = setup();
    expect(matchEmailToApplications(db, userId, input({ classification: 'General Update' })).bestMatch).toBeNull();
  });

  it('does not match a one-word name', () => {
    const { db, userId } = setup();
    seedContact(db, userId, 'app-other', 'contact-alex-short', 'Alex');
    db.delete(contacts).where(eq(contacts.id, 'contact-alex')).run();
    expect(matchEmailToApplications(db, userId, input({ recruiterName: 'Alex' })).bestMatch).toBeNull();
  });

  it('does not match when the email names a different role (issue #14)', () => {
    const { db, userId } = setup();
    expect(
      matchEmailToApplications(db, userId, input({ positionTitle: 'Staff Data Scientist' })).bestMatch,
    ).toBeNull();
    expect(
      matchEmailToApplications(db, userId, input({ positionTitle: 'Senior Engineering Manager, DC Buying' }))
        .bestMatch?.applicationId,
    ).toBe('app-grocer');
  });

  it('skips applications that are closed', () => {
    const { db, userId } = setup();
    db.update(applications).set({ status: 'rejected' }).where(eq(applications.id, 'app-grocer')).run();
    expect(matchEmailToApplications(db, userId, input()).bestMatch).toBeNull();
  });
});
