/** @jest-environment node */
import { getAiSpendLedger, pacificDay, registerAiSpendLedger } from './aiSpend.js';
import { generateDailyBriefingForUser } from './briefingGenerator.js';
import { classifyEmailContent } from './emailClassificationService.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { saveInboundEmail } from './postmarkInbound.js';
import { createTestDb, seedTestUser } from './testDb.js';

// Same outcomes as aiPausedFallback.test.ts, with AI_PROVIDER=gemini: Vertex
// answers 402 when prepaid credit is spent and 429 when we send too fast.
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue('fake-access-token'),
  })),
}));

const saved = { ...process.env };
function vertexAnswers(status: number, message: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code: status, message, status: 'RESOURCE_EXHAUSTED' } }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env = {
    ...saved,
    AI_PROVIDER: 'gemini',
    GOOGLE_CLOUD_PROJECT: 'test-project',
    VERTEX_LOCATION: 'global',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      private_key: 'not-a-real-key',
      client_email: 'svc@test-project.iam.gserviceaccount.com',
    }),
  };
  delete process.env.OPENAI_API_KEY;
  registerAiSpendLedger(createTestDb());
  vertexAnswers(402, 'Your prepayment credits are depleted.');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('when the Gemini budget is used up', () => {
  it('still writes the brief, marked as paused rather than failed', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(global.fetch).toHaveBeenCalled();
    expect(briefing?.status).toBe('completed');
    expect(briefing?.data.summarySource).toBe('paused');
    expect(briefing?.aiSummary).toBeTruthy();
    expect(error).not.toHaveBeenCalled();
  });

  it('still classifies email with the rules, without logging an error per email', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await classifyEmailContent({
      subject: 'Interview invitation',
      fromEmail: 'recruiter@example.com',
      textBody: 'We reviewed your resume and want to schedule an interview.',
    });
    expect(global.fetch).toHaveBeenCalled();
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
      MessageID: 'gemini-quota-1',
      TextBody: 'We reviewed your resume and want to schedule an interview.',
    });
    const result = await processInboundEmail(db, id, { userId });
    expect(result.processingStatus).toBe('processed');
  });
});

describe('when Vertex is only rate limiting for a moment', () => {
  it('writes an ordinary rules-only brief, not a "paused until next month" one', async () => {
    vertexAnswers(429, 'Resource exhausted. Please try again later.');
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(global.fetch).toHaveBeenCalled();
    expect(briefing?.data.summarySource).toBe('rules');
  });
});

describe('when Gemini is selected but not set up', () => {
  it('writes a rules-only brief without calling anything', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(briefing?.status).toBe('completed');
    expect(briefing?.data.summarySource).toBe('rules');
  });
});

describe('when the daily AI budget is spent', () => {
  beforeEach(() => {
    process.env.AI_DAILY_BUDGET_USD = '1';
    const ledger = getAiSpendLedger()!;
    const day = pacificDay(new Date());
    expect(ledger.reserve(day, 1_000_000, 2_000_000)).toBe(true); // $1.00 already spent today
  });

  it('writes a "paused" brief without calling Vertex', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(briefing?.status).toBe('completed');
    expect(briefing?.data.summarySource).toBe('paused');
    expect(error).not.toHaveBeenCalled();
  });

  it('classifies email with the rules, without calling Vertex or logging an error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await classifyEmailContent({
      subject: 'Interview invitation',
      fromEmail: 'recruiter@example.com',
      textBody: 'We reviewed your resume and want to schedule an interview.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.classification).toBe('Interview Request');
    expect(error).not.toHaveBeenCalled();
  });
});
