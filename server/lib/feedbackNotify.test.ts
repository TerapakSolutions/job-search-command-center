/** @jest-environment node */
import {
  escapeSlackText,
  formatPacific,
  isEmailNotifyConfigured,
  isSlackNotifyConfigured,
  sendFeedbackEmail,
  sendFeedbackSlack,
  type FeedbackReport,
} from './feedbackNotify.js';

const ENV_KEYS = [
  'FEEDBACK_SLACK_WEBHOOK_URL',
  'FEEDBACK_EMAIL_TO',
  'POSTMARK_SERVER_TOKEN',
  'POSTMARK_FROM_EMAIL',
] as const;

const report: FeedbackReport = {
  userEmail: 'jane@example.com',
  message: 'Hey <!channel> look at <@U123ABC> and <https://evil.example|your bank> & more',
  pageUrl: 'https://jobsearch.example.com/today?a=1&b=<x>',
  createdAt: '2026-11-13T20:05:00.000Z',
};

function okResponse(): Response {
  return new Response('ok', { status: 200 });
}

describe('feedbackNotify', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('escapeSlackText', () => {
    it('escapes & first, then < and >', () => {
      expect(escapeSlackText('a & <!channel> <@U1> &amp;')).toBe(
        'a &amp; &lt;!channel&gt; &lt;@U1&gt; &amp;amp;',
      );
    });
  });

  it('formats the time in Pacific regardless of the process TZ', () => {
    // 20:05 UTC on 2026-11-13 is 12:05 PM PST.
    expect(formatPacific('2026-11-13T20:05:00.000Z')).toMatch(/12:05\s?PM/);
    expect(formatPacific('2026-11-13T20:05:00.000Z')).toMatch(/PST/);
  });

  describe('Slack', () => {
    it('is skipped when the webhook URL is unset', async () => {
      const spy = jest.spyOn(globalThis, 'fetch');
      expect(isSlackNotifyConfigured()).toBe(false);
      await expect(sendFeedbackSlack(report)).resolves.toBe('skipped');
      expect(spy).not.toHaveBeenCalled();
    });

    it('posts a plain text payload with all user text escaped', async () => {
      process.env.FEEDBACK_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/T/B/X';
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
      await expect(sendFeedbackSlack({ ...report, userEmail: '<!here>@example.com' })).resolves.toBe('sent');

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0];
      expect(String(url)).toBe('https://hooks.slack.test/services/T/B/X');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(Object.keys(payload)).toEqual(['text']);
      const text = payload.text as string;
      expect(text).toContain('&lt;!channel&gt;');
      expect(text).toContain('&lt;@U123ABC&gt;');
      expect(text).toContain('&lt;https://evil.example|your bank&gt;');
      expect(text).toContain('&amp; more');
      expect(text).toContain('a=1&amp;b=&lt;x&gt;');
      expect(text).toContain('&lt;!here&gt;@example.com');
      expect(text).not.toMatch(/<!channel>|<!here>|<@U123ABC>|<https:/);
      expect(text).toMatch(/12:05\s?PM/);
    });

    it('throws with the status when Slack rejects the post', async () => {
      process.env.FEEDBACK_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/T/B/X';
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no_service', { status: 404 }));
      await expect(sendFeedbackSlack(report)).rejects.toThrow(/404/);
    });
  });

  describe('Email', () => {
    it('is skipped when any of the three settings is unset', async () => {
      const spy = jest.spyOn(globalThis, 'fetch');
      process.env.FEEDBACK_EMAIL_TO = 'feedback@example.com';
      process.env.POSTMARK_SERVER_TOKEN = 'test-token';
      // POSTMARK_FROM_EMAIL missing
      expect(isEmailNotifyConfigured()).toBe(false);
      await expect(sendFeedbackEmail(report)).resolves.toBe('skipped');

      delete process.env.FEEDBACK_EMAIL_TO;
      process.env.POSTMARK_FROM_EMAIL = 'app@example.com';
      // A Postmark token set for anything else must not email feedback on its own.
      expect(isEmailNotifyConfigured()).toBe(false);
      await expect(sendFeedbackEmail(report)).resolves.toBe('skipped');
      expect(spy).not.toHaveBeenCalled();
    });

    it('sends a plain-text Postmark email that replies to the reporter', async () => {
      process.env.FEEDBACK_EMAIL_TO = 'feedback@example.com';
      process.env.POSTMARK_SERVER_TOKEN = 'test-token';
      process.env.POSTMARK_FROM_EMAIL = 'app@example.com';
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
      await expect(sendFeedbackEmail(report)).resolves.toBe('sent');

      const [url, init] = spy.mock.calls[0];
      expect(String(url)).toBe('https://api.postmarkapp.com/email');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect((init?.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('test-token');
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body.From).toBe('app@example.com');
      expect(body.To).toBe('feedback@example.com');
      expect(body.ReplyTo).toBe('jane@example.com');
      expect(body.Subject).toBe('jobsearch: problem report from jane@example.com');
      expect(body.TextBody).toContain(report.message);
      expect(body.TextBody).toContain(report.pageUrl);
      expect(body.HtmlBody).toBeUndefined();
      expect(body.MessageStream).toBe('outbound');
    });

    it('throws with the status when Postmark rejects the send', async () => {
      process.env.FEEDBACK_EMAIL_TO = 'feedback@example.com';
      process.env.POSTMARK_SERVER_TOKEN = 'test-token';
      process.env.POSTMARK_FROM_EMAIL = 'app@example.com';
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 422 }));
      await expect(sendFeedbackEmail(report)).rejects.toThrow(/422/);
    });
  });
});
