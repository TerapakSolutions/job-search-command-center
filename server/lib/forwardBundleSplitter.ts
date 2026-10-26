import { extractHeaderBlock, parseEmailAddress } from './emailForwardedParser.js';
import type { PostmarkInboundPayload } from './postmarkInbound.js';

// Only explicit forward markers start a new message. "Original Message",
// "On … wrote:" and bare "From:" lines are reply history inside one email.
const BUNDLE_MARKER =
  /^(?:begin forwarded message:|-{3,}\s*forwarded message\s*-{3,})/gim;

interface BundleBlock {
  text: string;
  subject: string;
  fromEmail: string | null;
  toEmail: string | null;
}

function parseBlocks(textBody: string): BundleBlock[] {
  const starts = [...textBody.matchAll(BUNDLE_MARKER)].map((m) => m.index ?? 0);
  return starts.map((start, i) => {
    const text = textBody.slice(start, starts[i + 1] ?? textBody.length).trim();
    const headers = extractHeaderBlock(text)?.headers ?? {};
    return {
      text,
      subject: headers.subject?.trim() ?? '',
      fromEmail: parseEmailAddress(headers.from ?? '').email,
      toEmail: parseEmailAddress(headers.to ?? '').email,
    };
  });
}

function forwarderEmail(payload: PostmarkInboundPayload): string {
  const full = payload.FromFull as { Email?: unknown } | undefined;
  const email = typeof full?.Email === 'string' ? full.Email : payload.From;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Apple Mail "select several messages -> Forward" sends them inline as sibling
 * "Begin forwarded message:" blocks in one email. Split those into one payload
 * per message so each is classified on its own. Anything that is not clearly
 * such a bundle is returned unchanged as `[payload]`.
 */
export function splitForwardBundle(
  payload: PostmarkInboundPayload,
): PostmarkInboundPayload[] {
  const textBody = typeof payload.TextBody === 'string' ? payload.TextBody : '';
  const blocks = parseBlocks(textBody);
  if (blocks.length < 2) return [payload];

  // Siblings are all addressed to the same person (us). A nested forward's
  // inner message is addressed to whoever forwarded it on, so it differs.
  const recipient = blocks[0].toEmail;
  const forwarder = forwarderEmail(payload);
  const isBundle = blocks.every(
    (block) =>
      block.fromEmail !== null &&
      block.subject !== '' &&
      block.toEmail !== null &&
      block.toEmail === recipient &&
      block.fromEmail !== forwarder,
  );
  if (!isBundle) return [payload];

  const parentId = typeof payload.MessageID === 'string' ? payload.MessageID : '';
  return blocks.map((block, i) => ({
    ...payload,
    Subject: `Fwd: ${block.subject}`,
    MessageID: `${parentId}#part-${i + 1}`,
    TextBody: block.text,
    HtmlBody: '',
    StrippedTextReply: '',
    RawEmail: '',
    Attachments: [],
    BundleParentMessageID: parentId,
    BundlePart: i + 1,
    BundleSize: blocks.length,
  }));
}
