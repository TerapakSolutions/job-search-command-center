/** @jest-environment node */
import { classifyEmailContent } from './emailClassificationService.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { analyzeEmailAutomation } from './emailAutomationService.js';
import { generateNextActions } from './emailNextActions.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';
import { outlookOutboundTopNoNote } from './__fixtures__/outlookOutboundTopMessage.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

const mockLlm = jest.mocked(engine.classifyInboundEmailWithLlm);
const SUBJECT = 'FW: Solution Architect !! Location:  Example City !!';
const FORWARDER = 'steve@terapak.com';
// The forwarder's own follow-up, with no agreement phrase.
const FOLLOW_UP = outlookOutboundTopNoNote.replace(
  "Thanks for confirming. I'm open to moving forward at the confirmed rate. My updated resume, aligned to the job description, is attached.",
  'Checking in on next steps after the screen. I remain very interested.',
);

function llmResult(overrides: Partial<EmailClassificationResult>): EmailClassificationResult {
  return {
    classification: 'Follow-up Required',
    classificationConfidence: 85,
    companyName: null,
    positionTitle: null,
    recruiterName: null,
    requiresResponse: true,
    suggestedAction: 'Reply to Steve to provide an update on the hiring process.',
    actionDueAt: null,
    interviewDetected: false,
    interviewDatetime: null,
    aiSummary: 'Steve is following up.',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('suggested action on the forwarder\'s own reply', () => {
  it('says to wait for the counterparty instead of replying to yourself', async () => {
    expect(FOLLOW_UP).not.toBe(outlookOutboundTopNoNote);
    mockLlm.mockResolvedValue(llmResult({}));
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: FOLLOW_UP });
    expect(result.classification).toBe('Follow-up Required');
    expect(result.suggestedAction).toBe('Wait for Ravi Kumar to reply');
    expect(result.requiresResponse).toBe(false);
  });

  it.each([
    ['Scheduling', 'Prepare for your upcoming interview', 'Confirming Thursday at 2 PM works for the interview.'],
    ['Rejection', 'Archive the application and move on', "After reviewing everything, I'm going to pass on this one."],
    ['Offer', 'Review offer details and respond promptly', 'Thank you for the offer, I am reviewing it.'],
  ])('keeps the LLM action for %s', async (label, action, text) => {
    mockLlm.mockResolvedValue(
      llmResult({ classification: label as EmailClassificationResult['classification'], suggestedAction: action }),
    );
    const body = outlookOutboundTopNoNote.replace(
      "Thanks for confirming. I'm open to moving forward at the confirmed rate. My updated resume, aligned to the job description, is attached.",
      text,
    );
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.classification).toBe(label);
    expect(result.suggestedAction).toBe(action);
    expect(result.requiresResponse).toBe(false);
  });

  it('keeps the Agreed to Submission action', async () => {
    mockLlm.mockResolvedValue(llmResult({}));
    const result = await classifyEmailContent({
      subject: SUBJECT,
      fromEmail: FORWARDER,
      textBody: outlookOutboundTopNoNote,
    });
    expect(result.classification).toBe('Agreed to Submission');
    expect(result.suggestedAction).toBe('Wait for the recruiter to confirm the submission');
  });

  it('control: a recruiter email keeps the LLM suggestion', async () => {
    mockLlm.mockResolvedValue(llmResult({ suggestedAction: 'Reply with your availability' }));
    const result = await classifyEmailContent({
      subject: 'Following up',
      fromEmail: 'ravi.kumar@acmestaffing.example',
      textBody: 'Hi Steve, following up on the role. Any update?',
    });
    expect(result.suggestedAction).toBe('Reply with your availability');
  });
});

describe('next actions on the forwarder\'s own reply', () => {
  const base = {
    classification: 'Follow-up Required',
    requiresResponse: false,
    interviewDetected: false,
    suggestedAction: null,
    matches: { matches: [], bestMatch: null, requiresManualSelection: false, linkedApplicationId: null },
    pipelineProposal: null,
    canOfferApplicationCreation: false,
  };

  it('does not suggest sending a follow-up you just sent', () => {
    const actions = generateNextActions({ ...base, writtenByYou: true });
    expect(actions.map((a) => a.label)).not.toContain('Send follow-up');
    expect(actions.map((a) => a.type)).not.toContain('reply');
  });

  it('does not suggest replying to your own message, even on an older row still marked as needing a response', () => {
    const actions = generateNextActions({ ...base, requiresResponse: true, writtenByYou: true });
    expect(actions.map((a) => a.type)).not.toContain('reply');
  });

  it('control: a recruiter follow-up still suggests one', () => {
    const actions = generateNextActions({ ...base, writtenByYou: false });
    expect(actions.map((a) => a.label)).toContain('Send follow-up');
  });

  it('the automation panel recomputes "written by you" from the stored email', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const outbound = seedInboundEmail(db, {
      id: 'email-outbound',
      fromEmail: FORWARDER,
      toEmail: 'jobs@inbound.example',
      subject: SUBJECT,
      payload: JSON.stringify({ TextBody: FOLLOW_UP }),
      classification: 'Follow-up Required',
      classificationConfidence: 85,
      requiresResponse: false,
    });
    const labels = analyzeEmailAutomation(db, userId, outbound)?.nextActions.map((a) => a.label) ?? [];
    expect(labels).not.toContain('Send follow-up');

    const inbound = seedInboundEmail(db, {
      id: 'email-inbound',
      fromEmail: FORWARDER,
      toEmail: 'jobs@inbound.example',
      subject: 'Fw: Following up',
      payload: JSON.stringify({
        TextBody:
          '________________________________\nFrom: Ravi Kumar <ravi.kumar@acmestaffing.example>\nSent: Tuesday, 10 November 2026 05:49:19\nTo: Steve Terapak <steve@terapak.com>\nSubject: Following up\n\nHi Steve, any update?',
      }),
      classification: 'Follow-up Required',
      classificationConfidence: 85,
      requiresResponse: true,
    });
    const inboundLabels = analyzeEmailAutomation(db, userId, inbound)?.nextActions.map((a) => a.label) ?? [];
    expect(inboundLabels).toContain('Send follow-up');
  });
});
