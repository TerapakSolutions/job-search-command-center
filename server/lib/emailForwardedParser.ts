import {
  extractEmployerFromSubject,
  inferEmployerFromSenderEmail,
  isAtsPlatformCompany,
} from './emailContentExtraction.js';

// "Njoyn Helpdesk <helpdesk@njoyn.com> on behalf of CGI <...>" — the employer
// is the "on behalf of" party (CGI), not the ATS that sent the mail (Njoyn).
function extractOnBehalfOfCompany(fromHeader: string): string | null {
  const match = fromHeader.match(/on behalf of\s+(.+?)(?:\s*<|$)/i);
  const company = match?.[1]?.trim().replace(/[.,;]+$/, '');
  return company && company.length >= 2 && !isAtsPlatformCompany(company)
    ? company
    : null;
}

export interface ForwardedEmailMetadata {
  isForwarded: boolean;
  originalSenderEmail: string | null;
  originalSenderName: string | null;
  originalSubject: string | null;
  originalRecipient: string | null;
  originalSentAt: string | null;
  originalCompany: string | null;
  originalBody: string | null;
  // The top message is the forwarder's own reply (e.g. Steve forwarding a
  // thread whose newest message he wrote). originalSender* is then the nearest
  // quoted message by someone else, and originalBody is the top message only.
  topMessageFromForwarder: boolean;
}

const FORWARD_MARKERS = [
  /^-{3,}\s*forwarded message\s*-{3,}/im,
  /^begin forwarded message:/im,
  /^forwarded message/im,
  /^-{3,}\s*original message\s*-{3,}/im,
];

const EMAIL_PLAIN = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;

export function parseEmailAddress(value: string): { name: string | null; email: string | null } {
  // Outlook plain text quotes addresses as "Name <a@b.com<mailto:a@b.com>>".
  const trimmed = value.replace(/<mailto:[^>]*>/gi, '').trim();
  if (!trimmed) return { name: null, email: null };

  const angleMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/^["']|["']$/g, '').trim() || null,
      email: angleMatch[2].trim().toLowerCase(),
    };
  }

  const emailMatch = trimmed.match(EMAIL_PLAIN);
  if (emailMatch) {
    const email = emailMatch[1].toLowerCase();
    const namePart = trimmed.replace(emailMatch[0], '').replace(/[<>]/g, '').trim();
    return {
      name: namePart || null,
      email,
    };
  }

  return { name: trimmed, email: null };
}

function parseSentDate(value: string): string | null {
  // Apple Mail ("October 21, 2026 at 8:20 AM PDT") and Gmail ("Mon, Jul 1,
  // 2026 at 2:00 PM") put " at " before the time, which Date rejects.
  const trimmed = value.trim().replace(/\s+at\s+(?=\d)/i, ' ');
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const HEADER_LINE = /^(from|sent|date|fecha|to|cc|subject|de|para|asunto|betreff|von|an):\s*\S/i;
const FROM_LINE = /^(from|de|von):\s*\S/i;

// Character offsets of quoted header blocks: a From: line followed by
// consecutive header lines that include a sent/date line and a subject line.
// Outlook adds a Cc: line (and <mailto:> addresses), so the order and number
// of lines are not fixed.
function findHeaderBlockStarts(text: string): number[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (FROM_LINE.test(lines[i])) {
      const keys = new Set<string>();
      for (let j = i; j < lines.length && HEADER_LINE.test(lines[j]); j += 1) {
        keys.add(lines[j].split(':', 1)[0].trim().toLowerCase());
      }
      const hasSent = keys.has('sent') || keys.has('date') || keys.has('fecha');
      const hasSubject = keys.has('subject') || keys.has('asunto') || keys.has('betreff');
      if (hasSent && hasSubject) starts.push(offset);
    }
    offset += lines[i].length + 1;
  }
  return starts;
}

function findForwardBlockStart(text: string): number {
  const candidates: number[] = [];
  for (const pattern of FORWARD_MARKERS) {
    const match = pattern.exec(text);
    if (match && match.index >= 0) candidates.push(match.index);
  }
  const firstHeaderBlock = findHeaderBlockStarts(text)[0];
  if (firstHeaderBlock != null) candidates.push(firstHeaderBlock);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

export function extractHeaderBlock(text: string): {
  headers: Record<string, string>;
  bodyStart: number;
} | null {
  const lines = text.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let headerStart = -1;
  let bodyStart = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(
      /^(from|sent|date|to|subject|cc|de|para|asunto|betreff|von|an):\s*(.*)$/i,
    );
    if (match) {
      if (headerStart === -1) headerStart = i;
      const key = match[1].toLowerCase();
      const normalizedKey =
        key === 'de' || key === 'von'
          ? 'from'
          : key === 'para' || key === 'an'
            ? 'to'
            : key === 'asunto' || key === 'betreff'
              ? 'subject'
              : key;
      headers[normalizedKey] = match[2].trim();
      bodyStart = i + 1;
      continue;
    }

    if (headerStart >= 0 && line.trim() === '' && bodyStart >= 0) {
      bodyStart = i + 1;
      break;
    }

    if (headerStart >= 0 && line.trim() !== '' && !match) {
      break;
    }
  }

  if (!headers.from && !headers.subject) return null;
  return { headers, bodyStart: bodyStart >= 0 ? bodyStart : lines.length };
}

export function parseForwardedEmail(
  subject: string,
  fromEmail: string,
  textBody: string,
  // The forwarder's display name (Postmark FromName). Outlook sometimes
  // writes the top message's From: line as a bare display name.
  fromName?: string | null,
): ForwardedEmailMetadata {
  const notForwarded: ForwardedEmailMetadata = {
    isForwarded: false,
    originalSenderEmail: null,
    originalSenderName: null,
    originalSubject: null,
    originalRecipient: null,
    originalSentAt: null,
    originalCompany: null,
    originalBody: null,
    topMessageFromForwarder: false,
  };

  const body = textBody ?? '';
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();

  const hasForwardMarker =
    FORWARD_MARKERS.some((p) => p.test(body)) ||
    subjectLower.startsWith('fwd:') ||
    subjectLower.startsWith('fw:') ||
    bodyLower.includes('forwarded message') ||
    bodyLower.includes('begin forwarded message');

  const blockStart = findForwardBlockStart(body);
  const blockText = blockStart >= 0 ? body.slice(blockStart) : body;
  const headerBlock = extractHeaderBlock(blockText);

  if (!hasForwardMarker && !headerBlock?.headers.from) {
    return notForwarded;
  }

  const headers = headerBlock?.headers ?? {};
  const fromHeader = headers.from ?? '';
  const { name, email } = parseEmailAddress(fromHeader);
  // A name-only From: line that matches the forwarder's display name is the
  // forwarder.
  const isForwarderByName =
    !email &&
    !!name &&
    !!fromName?.trim() &&
    name.trim().toLowerCase() === fromName.trim().toLowerCase();
  const originalSenderEmail = email ?? (isForwarderByName ? fromEmail.toLowerCase() : null);
  const originalSenderName = name;

  let originalSubject = headers.subject?.trim() || null;
  if (!originalSubject) {
    const subjectMatch = subject.match(/^fw[d]?:\s*(.+)$/i);
    originalSubject = subjectMatch?.[1]?.trim() ?? null;
  }

  const originalRecipient = headers.to
    ? parseEmailAddress(headers.to).email ?? headers.to.trim()
    : null;

  const originalSentAt =
    parseSentDate(headers.sent ?? '') ?? parseSentDate(headers.date ?? '');

  let originalBody: string | null = null;
  if (headerBlock && headerBlock.bodyStart >= 0) {
    const lines = blockText.split(/\r?\n/);
    originalBody = lines.slice(headerBlock.bodyStart).join('\n').trim() || null;
  }

  // Outbound top message: the forwarder wrote the newest message in the
  // thread (a reply to someone else), rather than an Outlook "Fw:" envelope
  // addressed to the inbox. Classify that message on its own, and take the
  // counterparty from the nearest quoted message by someone else.
  const isForwarderEnvelope = /^(fw|fwd):/i.test(headers.subject ?? '');
  if (
    originalSenderEmail &&
    originalBody &&
    !isForwarderEnvelope &&
    originalSenderEmail.toLowerCase() === fromEmail.toLowerCase()
  ) {
    return parseOutboundTopMessage({
      forwarderEmail: fromEmail,
      topBody: originalBody,
      topSubject: originalSubject,
      topRecipient: originalRecipient,
      topSentAt: originalSentAt,
    });
  }

  // Double-forward: the first "From:" block is the forwarder re-forwarding
  // (sender == the address that forwarded to us). Unwrap the nested original
  // inside its body so we read the true sender/company, not the forwarder.
  if (
    originalSenderEmail &&
    originalBody &&
    originalSenderEmail.toLowerCase() === fromEmail.toLowerCase()
  ) {
    const nested = parseForwardedEmail(
      originalSubject ?? subject,
      fromEmail,
      originalBody,
      fromName,
    );
    if (
      nested.isForwarded &&
      nested.originalSenderEmail &&
      nested.originalSenderEmail.toLowerCase() !== fromEmail.toLowerCase()
    ) {
      return nested;
    }
  }

  const originalCompany =
    extractOnBehalfOfCompany(fromHeader) ??
    (originalSubject ? extractEmployerFromSubject(originalSubject) : null) ??
    inferEmployerFromSenderEmail(originalSenderEmail);

  if (!originalSenderEmail && !originalSubject && !originalBody) {
    return notForwarded;
  }

  return {
    isForwarded: true,
    originalSenderEmail,
    originalSenderName,
    originalSubject,
    originalRecipient,
    originalSentAt,
    originalCompany,
    originalBody,
    topMessageFromForwarder: false,
  };
}

function parseOutboundTopMessage(input: {
  forwarderEmail: string;
  topBody: string;
  topSubject: string | null;
  topRecipient: string | null;
  topSentAt: string | null;
}): ForwardedEmailMetadata {
  const forwarder = input.forwarderEmail.toLowerCase();
  const quotedStarts = findHeaderBlockStarts(input.topBody);

  // The top message ends where the first quoted header block begins; drop the
  // Outlook "____" separator line that precedes it.
  const topText = (
    quotedStarts.length > 0 ? input.topBody.slice(0, quotedStarts[0]) : input.topBody
  )
    .replace(/\n\s*_{10,}\s*$/, '')
    .trim();

  let counterpartyHeader: string | null = null;
  for (const start of quotedStarts) {
    const from = extractHeaderBlock(input.topBody.slice(start))?.headers.from ?? '';
    const email = parseEmailAddress(from).email;
    if (email && email !== forwarder) {
      counterpartyHeader = from;
      break;
    }
  }

  const counterparty = counterpartyHeader
    ? parseEmailAddress(counterpartyHeader)
    : { name: null, email: input.topRecipient };

  const originalCompany =
    (counterpartyHeader ? extractOnBehalfOfCompany(counterpartyHeader) : null) ??
    (input.topSubject ? extractEmployerFromSubject(input.topSubject) : null) ??
    inferEmployerFromSenderEmail(counterparty.email);

  return {
    isForwarded: true,
    originalSenderEmail: counterparty.email,
    originalSenderName: counterparty.name,
    originalSubject: input.topSubject,
    originalRecipient: input.topRecipient,
    originalSentAt: input.topSentAt,
    originalCompany,
    originalBody: topText || null,
    topMessageFromForwarder: true,
  };
}

export function classificationInputFromEmail(input: {
  subject: string;
  fromEmail: string;
  fromName?: string | null;
  textBody: string;
}): {
  subject: string;
  fromEmail: string;
  textBody: string;
  forwardMetadata: ForwardedEmailMetadata;
} {
  const forwardMetadata = parseForwardedEmail(
    input.subject,
    input.fromEmail,
    input.textBody,
    input.fromName,
  );

  if (!forwardMetadata.isForwarded) {
    return { ...input, forwardMetadata };
  }

  return {
    subject: forwardMetadata.originalSubject ?? input.subject,
    // An outbound top message was written by the forwarder, not the
    // counterparty recorded in originalSenderEmail.
    fromEmail: forwardMetadata.topMessageFromForwarder
      ? input.fromEmail
      : forwardMetadata.originalSenderEmail ?? input.fromEmail,
    textBody: forwardMetadata.originalBody ?? input.textBody,
    forwardMetadata,
  };
}
