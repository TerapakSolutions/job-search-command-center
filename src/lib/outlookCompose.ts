// Outlook on the web's compose deeplink. Opening it needs no permission from
// the user's mailbox: it's a link, and the user saves or sends in Outlook.
// Work and school accounts (outlook.office.com); personal Outlook.com
// accounts use outlook.live.com and aren't handled here.
const OUTLOOK_COMPOSE = 'https://outlook.office.com/mail/deeplink/compose';

// Not Microsoft work accounts: never sent as a hint, so the link behaves as
// before and the address doesn't go to Microsoft.
const CONSUMER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

export function outlookComposeUrl(input: {
  to: string | null | undefined;
  subject: string | null | undefined;
  body: string;
  // The user's own address, sent as login_hint so Outlook opens that
  // account even when the browser defaults to another work account.
  // Undocumented for this deeplink; verified by hand (2026-11-19).
  account?: string | null;
}): string {
  const params = new URLSearchParams();
  const account = input.account?.trim().toLowerCase() ?? '';
  if (account && !CONSUMER_DOMAINS.has(account.split('@')[1] ?? '')) {
    params.set('login_hint', account);
  }
  if (input.to) params.set('to', input.to);
  if (input.subject) params.set('subject', input.subject);
  params.set('body', input.body);
  // Outlook reads + as a literal plus; spaces must be %20.
  return `${OUTLOOK_COMPOSE}?${params.toString().replace(/\+/g, '%20')}`;
}
