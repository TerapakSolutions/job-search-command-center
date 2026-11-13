/**
 * Notifiers for "Report a problem". Each one is optional: when its settings are
 * unset it returns 'skipped' and makes no network call. Both throw on failure so
 * the caller can record the error on the saved row.
 */

export interface FeedbackReport {
  userEmail: string;
  message: string;
  pageUrl: string | null;
  createdAt: string;
}

export type NotifyResult = 'sent' | 'skipped';

const NOTIFY_TIMEOUT_MS = 5_000;

/**
 * Slack treats `<...>` as control sequences (`<!channel>`, `<@U…>`, `<url|label>`).
 * Escaping & < > in every user-supplied string makes them literal text, so a
 * report can't ping a channel or show a spoofed link. `&` must go first.
 */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The report time in Pacific, independent of the process TZ. */
export function formatPacific(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ` ${pacificAbbreviation(iso)}`;
}

function pacificAbbreviation(iso: string): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short',
  })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? 'Pacific';
}

export function isSlackNotifyConfigured(): boolean {
  return Boolean(process.env.FEEDBACK_SLACK_WEBHOOK_URL?.trim());
}

export function isEmailNotifyConfigured(): boolean {
  return Boolean(
    process.env.FEEDBACK_EMAIL_TO?.trim() &&
      process.env.POSTMARK_SERVER_TOKEN?.trim() &&
      process.env.POSTMARK_FROM_EMAIL?.trim(),
  );
}

export async function sendFeedbackSlack(report: FeedbackReport): Promise<NotifyResult> {
  const webhookUrl = process.env.FEEDBACK_SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) return 'skipped';

  // Plain `text` only: never build blocks or mrkdwn links from user text.
  const text = [
    'jobsearch: problem report',
    `From: ${escapeSlackText(report.userEmail)}`,
    `Page: ${escapeSlackText(report.pageUrl ?? '(none)')}`,
    `When: ${formatPacific(report.createdAt)}`,
    '',
    escapeSlackText(report.message),
  ].join('\n');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return 'sent';
}

/** Same Postmark API call as briefingEmail.ts, but plain text and its own gate. */
export async function sendFeedbackEmail(report: FeedbackReport): Promise<NotifyResult> {
  const to = process.env.FEEDBACK_EMAIL_TO?.trim();
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const from = process.env.POSTMARK_FROM_EMAIL?.trim();
  if (!to || !token || !from) return 'skipped';

  const textBody = [
    `Problem report from ${report.userEmail}`,
    `Page: ${report.pageUrl ?? '(none)'}`,
    `When: ${formatPacific(report.createdAt)}`,
    '',
    report.message,
    '',
    'Reply to this email to answer the reporter directly.',
  ].join('\n');

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      ReplyTo: report.userEmail,
      Subject: `jobsearch: problem report from ${report.userEmail}`,
      TextBody: textBody,
      MessageStream: 'outbound',
    }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Postmark send failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return 'sent';
}
