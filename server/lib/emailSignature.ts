/**
 * Reads a sender's title, phone number and LinkedIn profile from their email
 * signature. Only the sender's own message is read: in a forwarded thread
 * that is the quoted message whose From: header names their address, so the
 * forwarder's signature and anyone else's are never picked up.
 */
export interface SenderSignature {
  title: string | null;
  phone: string | null;
  linkedIn: string | null;
}

const EMPTY: SenderSignature = { title: null, phone: null, linkedIn: null };

const FROM_HEADER = /^\s*(?:From|De|Von)\s*:/i;
const OTHER_HEADER = /^\s*(?:Sent|Date|To|Cc|Bcc|Subject|Reply-To)\s*:/i;
const MESSAGE_BOUNDARY = /^\s*(?:_{10,}|-{5,}\s*Original Message\s*-{5,})\s*$/i;
const PHONE_LINE =
  /^\s*(?:c|m|p|t|o|cell|mobile|phone|tel|direct|office)\s*[:.]\s*(\+?\(?\d[\d\s().-]{6,}\d)\s*$/im;
const LINKEDIN_PROFILE = /linkedin\.com\/in\/([A-Za-z0-9_%-]+)/i;

function senderBlock(lines: string[], email: string): string[] | null {
  const needle = email.trim().toLowerCase();
  const fromIndex = lines.findIndex(
    (line) => FROM_HEADER.test(line) && line.toLowerCase().includes(needle),
  );
  if (fromIndex < 0) return null;
  let start = fromIndex + 1;
  while (start < lines.length && OTHER_HEADER.test(lines[start])) start += 1;
  let end = start;
  while (
    end < lines.length &&
    !MESSAGE_BOUNDARY.test(lines[end]) &&
    !FROM_HEADER.test(lines[end])
  ) {
    end += 1;
  }
  return lines.slice(start, end);
}

// A message that is not a forward: the sender's text runs until the first
// quoted earlier message.
function topMessage(lines: string[]): string[] {
  const end = lines.findIndex((line) => MESSAGE_BOUNDARY.test(line) || FROM_HEADER.test(line));
  return end < 0 ? lines : lines.slice(0, end);
}

function nameCandidates(name: string | null | undefined, email: string): string[] {
  const candidates = new Set<string>();
  const full = name?.trim().toLowerCase();
  if (full) {
    candidates.add(full);
    candidates.add(full.split(/\s+/)[0]);
  }
  const local = email.split('@')[0]?.toLowerCase().split(/[._-]/)[0];
  if (local) candidates.add(local);
  return [...candidates].filter((c) => c.length > 1);
}

function looksLikeTitle(line: string): boolean {
  const t = line.trim();
  return (
    t.length > 1 &&
    t.length <= 60 &&
    !/[@:<>]/.test(t) &&
    !/\d/.test(t) &&
    !/https?:|www\.|\.com\b/i.test(t) &&
    !/^(?:sent from|get outlook|sent via)\b/i.test(t)
  );
}

function findTitle(block: string[], names: string[]): string | null {
  // The signature is at the bottom, so take the last line that is just the
  // sender's name; the next non-empty line is their title.
  for (let i = block.length - 1; i >= 0; i -= 1) {
    const line = block[i].trim().replace(/[,.]$/, '').toLowerCase();
    if (!names.includes(line)) continue;
    const next = block.slice(i + 1).find((l) => l.trim());
    return next && looksLikeTitle(next) ? next.trim() : null;
  }
  return null;
}

export function parseSenderSignature(
  text: string,
  sender: { email: string; name?: string | null; wholeBody?: boolean },
): SenderSignature {
  const lines = text.split(/\r?\n/);
  const block = sender.wholeBody ? topMessage(lines) : senderBlock(lines, sender.email);
  if (!block) return { ...EMPTY };
  const body = block.join('\n');

  const linkedInSlug = body.match(LINKEDIN_PROFILE)?.[1] ?? null;
  return {
    title: findTitle(block, nameCandidates(sender.name, sender.email)),
    phone: body.match(PHONE_LINE)?.[1]?.trim() ?? null,
    linkedIn: linkedInSlug ? `https://www.linkedin.com/in/${linkedInSlug}` : null,
  };
}
