/** @jest-environment node */
import {
  generateDailyBriefingForUser,
  getBriefingForDate,
  listBriefings,
} from './briefingGenerator.js';
import { createTestDb, seedApplication, seedTestUser } from './testDb.js';

describe('generateDailyBriefingForUser', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('generates one briefing per user per day (idempotent)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId);

    const first = await generateDailyBriefingForUser(db, userId);
    const second = await generateDailyBriefingForUser(db, userId);

    expect(first).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(listBriefings(db, userId).length).toBe(1);
    expect(first?.aiSummary.length).toBeGreaterThan(0);
    expect(first?.data.recommendations.length).toBeGreaterThan(0);

    jest.useRealTimers();
  });

  it('isolates briefings per user', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const db = createTestDb();
    const userA = seedTestUser(db, { id: 'user-a', email: 'a@example.com' });
    const userB = seedTestUser(db, { id: 'user-b', email: 'b@example.com' });

    seedApplication(db, userA, { id: 'app-a', company: 'Alpha' });
    seedApplication(db, userB, { id: 'app-b', company: 'Beta' });
    seedApplication(db, userB, { id: 'app-b2', company: 'Beta Two' });

    const briefingA = await generateDailyBriefingForUser(db, userA);
    const briefingB = await generateDailyBriefingForUser(db, userB);

    expect(briefingA?.data.pipelineStats.total).toBe(1);
    expect(briefingB?.data.pipelineStats.total).toBe(2);
    expect(briefingA?.id).not.toBe(briefingB?.id);

    jest.useRealTimers();
  });

  it('uses fallback summary when LLM is not configured', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-02T12:00:00.000Z'));

    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId);

    const briefing = await generateDailyBriefingForUser(db, userId);
    expect(briefing?.aiSummary).toContain('pipeline has');
    expect(getBriefingForDate(db, userId, '2026-07-02')).not.toBeNull();

    jest.useRealTimers();
  });
});

describe('briefing summary source (#42)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    global.fetch = originalFetch;
  });

  async function generate() {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId);
    return generateDailyBriefingForUser(db, userId, new Date('2026-10-26T20:00:00.000Z'));
  }

  it('records rules when no LLM key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    expect((await generate())?.data.summarySource).toBe('rules');
  });

  it('records llm when the model wrote the summary', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Written by the model.' } }] }),
    }) as unknown as typeof fetch;

    const briefing = await generate();
    expect(briefing?.aiSummary).toBe('Written by the model.');
    expect(briefing?.data.summarySource).toBe('llm');
  });

  it('records rules when the LLM call fails (e.g. a malformed key)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Cannot convert argument to a ByteString')) as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await generate())?.data.summarySource).toBe('rules');
  });
});
