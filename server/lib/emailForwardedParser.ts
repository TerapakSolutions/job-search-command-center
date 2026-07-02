import {
  extractEmployerFromSubject,
  inferEmployerFromSenderEmail,
} from './emailContentExtraction.js';

export interface ForwardedEmailMetadata {
  isForwarded: boolean;
  originalSenderEmail: string | null;
  originalSenderName: string | null;
  originalSubject: string | null;
  originalRecipient: string | null;
  originalSentAt: string | null;
  originalCompany: string | null;
  originalBody: string | null;
}

const FORWARD_MARKERS = [
  /^-{3,}\s*forwarded message\s*-{3,}/im,
  /^begin forwarded message:/im,
  /^forwarded message/im,
  /^-{3,}\s*original message\s*-{3,}/im,
];

const EMAIL_IN_ANGLE = /<([^>]+@[^>]+)>/;
const EMAIL_PLAIN = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;

function parseEmailAddress(value: string): { name: string | null; email: string | null } {
  const trimmed = value.trim();
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
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function findForwardBlockStart(text: string): number {
  for (const pattern of FORWARD_MARKERS) {
    const match = pattern.exec(text);
    if (match && match.index >= 0) return match.index;
  }

  const headerBlock = text.match(
    /\n(?:from|de|von):\s*.+\n(?:sent|date|fecha):\s*.+\n(?:to|para|an):\s*.+\n(?:subject|asunto|betreff):\s*.+/i,
  );
  if (headerBlock && headerBlock.index != null) {
    return headerBlock.index;
  }

  return -1;
}

function extractHeaderBlock(text: string): {
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
  const originalSenderEmail = email;
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

  const originalCompany =
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
  };
}

export function classificationInputFromEmail(input: {
  subject: string;
  fromEmail: string;
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
  );

  if (!forwardMetadata.isForwarded) {
    return { ...input, forwardMetadata };
  }

  return {
    subject: forwardMetadata.originalSubject ?? input.subject,
    fromEmail: forwardMetadata.originalSenderEmail ?? input.fromEmail,
    textBody: forwardMetadata.originalBody ?? input.textBody,
    forwardMetadata,
  };
}
