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

const SUBJECT = 'FW: Solution Architect !! Location:  Example City !!';
const FORWARDER = 'steve@terapak.com';

function llmResult(overrides: Partial<EmailClassificationResult>): EmailClassificationResult {
  return {
    classification: 'Follow-up Required',
    classificationConfidence: 80,
    companyName: null,
    positionTitle: 'Solution Architect',
    recruiterName: null,
    requiresResponse: false,
    suggestedAction: 'Wait for the recruiter to submit.',
    actionDueAt: null,
    interviewDetected: false,
    interviewDatetime: null,
    aiSummary: 'Candidate agreed to move forward.',
    ...overrides,
  };
}

// The classifier now reads the forwarder's own message, from the forwarder's
// address. Whatever recruiter or company it extracts from that text describes
// the forwarder, so the counterparty must come from the quoted message.
describe.each([
  ['no note', outlookOutboundTopNoNote],
  ['signature above', outlookOutboundTopWithSignature],
])('outbound top message (%s): recruiter and company come from the counterparty', (_l, body) => {
  beforeEach(() => jest.clearAllMocks());

  it('rules path (no LLM)', async () => {
    mockLlm.mockResolvedValue(null);
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.recruiterName).toBe('Ravi Kumar');
    expect(result.companyName).not.toBe('Terapak');
  });

  it('LLM names the forwarder as recruiter and company', async () => {
    mockLlm.mockResolvedValue(llmResult({ recruiterName: 'Steve Terapak', companyName: 'Terapak' }));
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.recruiterName).toBe('Ravi Kumar');
    expect(result.companyName).not.toBe('Terapak');
  });

  it('keeps a real client company the LLM found', async () => {
    mockLlm.mockResolvedValue(llmResult({ companyName: 'Client Co' }));
    const result = await classifyEmailContent({ subject: SUBJECT, fromEmail: FORWARDER, textBody: body });
    expect(result.companyName).toBe('Client Co');
    expect(result.recruiterName).toBe('Ravi Kumar');
  });
});
