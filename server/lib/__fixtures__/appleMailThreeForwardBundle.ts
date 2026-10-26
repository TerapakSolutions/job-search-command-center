// Real Apple Mail "select 3 messages -> Forward" Postmark inbound payload
// (prod, 2026-10-26), with personal addresses/names replaced. Apple Mail
// emits the messages inline as sibling "Begin forwarded message:" blocks,
// with an empty outer Subject.
export const APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD = {
  From: 'seeker@example.com',
  FromFull: { Email: 'seeker@example.com', Name: 'Alex Seeker', MailboxHash: '' },
  OriginalRecipient: 'seeker@example.com',
  Subject: '',
  MessageID: '1384e1be-80fa-4155-ad4a-2d92f553bf85',
  Date: 'Mon, 26 Oct 2026 19:09:48 +0000',
  TextBody: "\n\nBegin forwarded message:\n\nFrom: Acme's Hiring Team <no-reply@ashbyhq.com>\nSubject: Hello from Acme! We have your application.\nDate: October 26, 2026 at 8:17:50 AM PDT\nTo: seeker@example.com\n\nHi Alex,\n\nWe've received your application for the Role One role at Acme! Thank you for taking the time to apply. We know both the time and effort required for these applications, and we really appreciate your consideration.\n\nFrom here, we'll be digging into your application alongside our other candidates and will be in touch soon. In the meantime, please take a look at what we're building (and why it matters), you can learn more here<https://acme.example/product>.\n\nTalk soon,\nThe Acme Recruiting Team\nBegin forwarded message:\n\nFrom: Acme's Hiring Team <no-reply@ashbyhq.com>\nSubject: Hello from Acme! We have your application.\nDate: October 26, 2026 at 7:32:03 AM PDT\nTo: seeker@example.com\n\nHi Alex,\n\nWe've received your application for the Role Two role at Acme! Thank you for taking the time to apply. We know both the time and effort required for these applications, and we really appreciate your consideration.\n\nFrom here, we'll be digging into your application alongside our other candidates and will be in touch soon. In the meantime, please take a look at what we're building (and why it matters), you can learn more here<https://acme.example/product>.\n\nTalk soon,\nThe Acme Recruiting Team\nBegin forwarded message:\n\nFrom: Acme's Hiring Team <no-reply@ashbyhq.com>\nSubject: Hello from Acme! We have your application.\nDate: October 26, 2026 at 7:40:01 AM PDT\nTo: seeker@example.com\n\nHi Alex,\n\nWe've received your application for the Role Three role at Acme! Thank you for taking the time to apply. We know both the time and effort required for these applications, and we really appreciate your consideration.\n\nFrom here, we'll be digging into your application alongside our other candidates and will be in touch soon. In the meantime, please take a look at what we're building (and why it matters), you can learn more here<https://acme.example/product>.\n\nTalk soon,\nThe Acme Recruiting Team\n\n",
  HtmlBody: '<div>three forwarded messages</div>',
  StrippedTextReply: '',
  RawEmail: 'raw mime omitted',
  Attachments: [],
};
