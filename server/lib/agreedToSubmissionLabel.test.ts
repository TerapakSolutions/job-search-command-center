/** @jest-environment node */
import { classifyEmailContent } from './emailClassificationService.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import {
  outlookOutboundTopNoNote,
  outlookOutboundTopWithSignature,
} from './__fixtures__/outlookOutboundTopMessage.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

const mockLlm = jest.mocked(engine.classifyInboundEmailWithLlm);
const { classifyInboundEmailWithRules } = jest.requireActual<typeof engine>(
  './emailClassificationEngine.js',
);

const SUBJECT = 'FW: Solution Architect !! Location:  Example City !!';
const FORWARDER = 'steve@terapak.com';
const AGREEMENT =
  "Thanks for confirming. I'm open to moving forward at the confirmed rate. My updated resume, aligned to the job description, is attached.";

function llmResult(overrides: Partial<EmailClassificationResult>): EmailClassificationResult {
  return {
    classification: 'Other',
    classificationConfidence: 80,
    companyName: null,
    positionTitle: null,
    recruiterName: null,
    requiresResponse: false,
    suggestedAction: 'Review',
    actionDueAt: null,
    interviewDetected: false,
    interviewDatetime: null,
    aiSummary: 'Summary.',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLlm.mockResolvedValue(null);
});

describe.each([
  ['no note', outlookOutboundTopNoNote],
  ['signature above', outlookOutboundTopWithSignature],
])('the forwarder agreeing to be submitted (%s)', (_l, body) => {
  it('is labelled Agreed to Submission on the rules path (no LLM)', async () => {
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.classification).toBe('Agreed to Submission');
    expect(result.requiresResponse).toBe(false);
  });

  it('tells the LLM the message was written by the candidate', async () => {
    await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(mockLlm).toHaveBeenCalledWith(expect.objectContaining({ writtenByCandidate: true }));
  });

  it.each(['Rejection', 'Recruiter Outreach'] as const)(
    'wins over an LLM label of %s',
    async (llmLabel) => {
      mockLlm.mockResolvedValue(llmResult({ classification: llmLabel, requiresResponse: true }));
      const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
      expect(result.classification).toBe('Agreed to Submission');
      expect(result.requiresResponse).toBe(false);
    },
  );

  it('never needs a response from the forwarder, whatever the LLM says', async () => {
    mockLlm.mockResolvedValue(
      llmResult({ classification: 'Agreed to Submission', requiresResponse: true }),
    );
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.classification).toBe('Agreed to Submission');
    expect(result.requiresResponse).toBe(false);
  });
});

describe('controls', () => {
  it('a forwarded decline from the forwarder is not Agreed to Submission (rules path)', async () => {
    expect(outlookOutboundTopNoNote).toContain(AGREEMENT);
    const body = outlookOutboundTopNoNote.replace(
      AGREEMENT,
      "After reviewing everything, I'm going to pass on this one. It doesn't align with what I'm looking for at this point.",
    );
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.classification).not.toBe('Agreed to Submission');
  });

  it('a forwarded decline keeps the LLM\'s Rejection', async () => {
    mockLlm.mockResolvedValue(llmResult({ classification: 'Rejection' }));
    const body = outlookOutboundTopNoNote.replace(
      AGREEMENT,
      "After reviewing everything, I'm going to pass on this one. It doesn't align with what I'm looking for at this point.",
    );
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.classification).toBe('Rejection');
  });

  it('"not open to moving forward" from the candidate is not Agreed to Submission', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'RE: Solution Architect',
      fromEmail: FORWARDER,
      textBody: "Hi Ravi, I'm not open to moving forward with this one.",
      writtenByCandidate: true,
    });
    expect(result.classification).not.toBe('Agreed to Submission');
  });

  it('a recruiter asking for consent is not Agreed to Submission, even if the LLM says so', async () => {
    mockLlm.mockResolvedValue(llmResult({ classification: 'Agreed to Submission' }));
    const result = await classifyEmailContent({
      subject: 'Right to represent: Solution Architect',
      fromEmail: 'ravi.kumar@acmestaffing.example',
      textBody:
        'Hi Steve, please confirm you are open to moving forward and give us the right to represent you for this role.',
    });
    expect(result.classification).not.toBe('Agreed to Submission');
    expect(mockLlm.mock.calls[0][0].writtenByCandidate).toBeFalsy();
  });

  it('the rules ignore agreement phrases unless the candidate wrote the message', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'Solution Architect',
      fromEmail: 'ravi.kumar@acmestaffing.example',
      textBody: "Please confirm you're open to moving forward so we can submit you.",
    });
    expect(result.classification).not.toBe('Agreed to Submission');
  });
});
