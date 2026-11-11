/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, contacts, inboundEmails } from '../db/schema.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  ALREADY_SUBMITTED_SUBJECT,
  outlookAlreadySubmittedElsewhere,
} from './__fixtures__/outlookAlreadySubmittedElsewhere.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

const FORWARDER = 'steve@terapak.com';
const VENDOR_EMAIL = 'priya.nair@vendortwo.example';

const prodShape: EmailClassificationResult = {
  classification: 'Agreed to Submission',
  classificationConfidence: 95,
  companyName: 'Example Insurer',
  positionTitle: 'Solution Architect',
  recruiterName: 'Priya Nair',
  requiresResponse: false,
  suggestedAction: 'Consider other roles for the candidate',
  actionDueAt: null,
  interviewDetected: false,
  interviewDatetime: null,
  aiSummary: 'The candidate told the recruiter they are already submitted elsewhere.',
};

function setup(options: { withApplication?: boolean; textBody?: string } = {}) {
  jest.mocked(engine.classifyInboundEmailWithLlm).mockResolvedValue(prodShape);
  const db = createTestDb();
  const userId = seedTestUser(db, { email: FORWARDER });
  if (options.withApplication !== false) {
    seedApplication(db, userId, {
      id: 'app-insurer',
      company: 'Example Insurer',
      roleTitle: 'Solution Architect',
      status: 'recruiter_screen',
      updatedAt: '2026-11-10T23:10:00.000Z',
    });
    db.update(applications).set({ agency: 'First Vendor' }).where(eq(applications.id, 'app-insurer')).run();
  }
  const id = seedInboundEmail(db, {
    id: 'email-dup-vendor',
    fromEmail: FORWARDER,
    toEmail: 'jobinfo@jobs.example',
    subject: ALREADY_SUBMITTED_SUBJECT,
    payload: JSON.stringify({
      FromName: 'Steve Terapak',
      TextBody: options.textBody ?? outlookAlreadySubmittedElsewhere,
    }),
  });
  return { db, userId, id };
}

const vendorContacts = (db: ReturnType<typeof createTestDb>) =>
  db.select().from(contacts).where(eq(contacts.email, VENDOR_EMAIL)).all();

describe('a second vendor on a role you are already submitted to', () => {
  it('saves the vendor recruiter as a contact from the signature, linked as a secondary vendor', async () => {
    const { db, userId, id } = setup();
    const before = db.select().from(applications).where(eq(applications.id, 'app-insurer')).all()[0];

    await processInboundEmail(db, id, { userId });

    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).all()[0];
    expect(row.classification).toBe('Already Submitted Elsewhere');
    const saved = vendorContacts(db);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Priya Nair',
      title: 'US IT Recruiter',
      phone: '+1 555-0199',
      linkedIn: 'https://www.linkedin.com/in/example-recruiter',
      applicationId: 'app-insurer',
      nextAction: '',
    });
    expect(saved[0].messageNotes).toContain('Secondary vendor');
    expect(saved[0].messageNotes).toContain('via First Vendor');
    // The contact works for the vendor, not the client.
    expect(saved[0].company).toBe('Vendortwo');
    expect(saved[0].company).not.toBe('Example Insurer');
    expect(saved[0].company).not.toBe('First Vendor');

    const after = db.select().from(applications).where(eq(applications.id, 'app-insurer')).all()[0];
    expect(after).toEqual(before);
  });

  it('fills only empty fields on an existing contact, never what you typed', async () => {
    const { db, userId, id } = setup();
    db.insert(contacts)
      .values({
        id: 'contact-typed',
        userId,
        applicationId: 'app-insurer',
        name: 'Priya N.',
        email: VENDOR_EMAIL,
        linkedIn: '',
        phone: '555-0000',
        title: null,
        company: 'Vendor Two',
        source: 'manual',
        lastContactDate: null,
        messageNotes: 'Met at a meetup.',
        nextAction: '',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      })
      .run();

    await processInboundEmail(db, id, { userId });

    const saved = vendorContacts(db);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      phone: '555-0000',
      title: 'US IT Recruiter',
      linkedIn: 'https://www.linkedin.com/in/example-recruiter',
    });
    expect(saved[0].messageNotes).toContain('Met at a meetup.');
  });

  it('Re-analyze does not save the contact twice or repeat the note', async () => {
    const { db, userId, id } = setup();
    await processInboundEmail(db, id, { userId });
    await processInboundEmail(db, id, { userId, reanalysis: true, manual: true });

    const saved = vendorContacts(db);
    expect(saved).toHaveLength(1);
    expect(saved[0].messageNotes.match(/Secondary vendor/g)).toHaveLength(1);
  });

  it('Re-analyze saves the contact for an email processed before this label existed (the prod case)', async () => {
    const { db, userId, id } = setup();
    db.update(inboundEmails)
      .set({
        processingStatus: 'processed',
        classification: 'Agreed to Submission',
        classificationConfidence: 95,
      })
      .where(eq(inboundEmails.id, id))
      .run();

    await processInboundEmail(db, id, { userId, reanalysis: true, manual: true });

    expect(vendorContacts(db)).toHaveLength(1);
  });

  it('control: with no matching application, no contact is saved automatically', async () => {
    const { db, userId, id } = setup({ withApplication: false });
    await processInboundEmail(db, id, { userId });
    expect(vendorContacts(db)).toEqual([]);
  });
});
