/** @jest-environment node */
import { generateDailyBriefingForUser } from './briefingGenerator.js';
import { classifyEmailContent } from './emailClassificationService.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { saveInboundEmail } from './postmarkInbound.js';
import { createTestDb, seedTestUser } from './testDb.js';

// OpenAI answers 429 when the monthly budget is spent or we send too fast.
const saved = { ...process.env };
function openAiAnswers429(code: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { code } }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env = { ...saved, OPENAI_API_KEY: 'sk-test' };
  openAiAnswers429('insufficient_quota');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('when the AI budget is used up', () => {
  it('still writes the brief, marked as paused rather than failed', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(briefing?.status).toBe('completed');
    expect(briefing?.data.summarySource).toBe('paused');
    expect(briefing?.aiSummary).toBeTruthy();
    expect(error).not.toHaveBeenCalled();
  });

  it('still classifies email with the rules, without logging an error per email', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await classifyEmailContent({
      subject: 'Interview invitation',
      fromEmail: 'recruiter@acme.com',
      textBody: 'We reviewed your resume and want to schedule an interview.',
    });
    expect(result.classification).toBe('Interview Request');
    expect(error).not.toHaveBeenCalled();
  });

  it('saves and processes a forwarded email', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const id = await saveInboundEmail(db, {
      Subject: 'Interview invitation',
      FromFull: { Email: 'seeker@example.com' },
      OriginalRecipient: 'jobinfo@jobs.example.com',
      MessageID: 'quota-1',
      TextBody: 'We reviewed your resume and want to schedule an interview.',
    });
    const result = await processInboundEmail(db, id, { userId });
    expect(result.processingStatus).toBe('processed');
  });
});

describe('when OpenAI is only rate limiting for a moment', () => {
  it('writes an ordinary rules-only brief, not a "paused until next month" one', async () => {
    openAiAnswers429('rate_limit_exceeded');
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(briefing?.data.summarySource).toBe('rules');
  });
});
