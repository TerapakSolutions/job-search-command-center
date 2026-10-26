/** @jest-environment node */
import { inboundEmails } from '../db/schema.js';
import { APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD } from './__fixtures__/appleMailThreeForwardBundle.js';
import { splitForwardBundle } from './forwardBundleSplitter.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { saveInboundEmail } from './postmarkInbound.js';
import { createTestDb, seedTestUser } from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual('./emailClassificationEngine.js') as typeof import('./emailClassificationEngine.js');
  return {
    classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
    classifyInboundEmailWithRules: actual.classifyInboundEmailWithRules,
  };
});

describe('Apple Mail multi-message forward, end to end', () => {
  it('processes each confirmation as its own email', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const ids: string[] = [];
    for (const part of splitForwardBundle(APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD)) {
      ids.push(await saveInboundEmail(db, part));
    }
    for (const id of ids) {
      const result = await processInboundEmail(db, id, { userId, manual: true });
      expect(result.processingStatus).toBe('processed');
    }

    const rows = db.select().from(inboundEmails).all();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.processingStatus).toBe('processed');
      expect(row.isForwarded).toBe(true);
      expect(row.originalSenderEmail).toBe('no-reply@ashbyhq.com');
      expect(row.companyName).toBe('Acme');
    }
  });
});
