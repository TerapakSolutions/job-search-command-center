// Outlook on the web's compose deeplink. Opening it needs no permission from
// the user's mailbox: it's a link, and the user saves or sends in Outlook.
// Work and school accounts (outlook.office.com); personal Outlook.com
// accounts use outlook.live.com and aren't handled here.
const OUTLOOK_COMPOSE = 'https://outlook.office.com/mail/deeplink/compose';

export function outlookComposeUrl(input: {
  to: string | null | undefined;
  subject: string | null | undefined;
  body: string;
}): string {
  const params = new URLSearchParams();
  if (input.to) params.set('to', input.to);
  if (input.subject) params.set('subject', input.subject);
  params.set('body', input.body);
  // Outlook reads + as a literal plus; spaces must be %20.
  return `${OUTLOOK_COMPOSE}?${params.toString().replace(/\+/g, '%20')}`;
}
