import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createDb } from '../db/index.js';
import { createApp } from '../app.js';
import { getInboundEmailById } from '../routes/postmarkInbound.js';

const samplePayload = {
  FromName: 'Postmarkapp Support',
  MessageStream: 'inbound',
  From: 'support@postmarkapp.com',
  FromFull: {
    Email: 'support@postmarkapp.com',
    Name: 'Postmarkapp Support',
    MailboxHash: '',
  },
  To: '"Firstname Lastname" <yourhash+SampleHash@inbound.postmarkapp.com>',
  ToFull: [
    {
      Email: 'yourhash+SampleHash@inbound.postmarkapp.com',
      Name: 'Firstname Lastname',
      MailboxHash: 'SampleHash',
    },
  ],
  OriginalRecipient: 'yourhash+SampleHash@inbound.postmarkapp.com',
  Subject: 'Test subject',
  MessageID: '73e6d360-66eb-11e1-8e72-a8904824019b',
  Date: 'Fri, 1 Aug 2014 16:45:32 -04:00',
  TextBody: 'This is a test text body.',
};

async function postJson(baseUrl: string, body: unknown) {
  const response = await fetch(`${baseUrl}/webhooks/postmark/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `inbound-integration-${Date.now()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;

  const db = createDb();
  const app = createApp(db);
  const server: Server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const okResponse = await postJson(baseUrl, samplePayload);
    assert.equal(okResponse.status, 200);
    assert.equal(okResponse.body.ok, true);
    assert.ok(typeof okResponse.body.id === 'string');

    const savedResponse = await postJson(baseUrl, {
      ...samplePayload,
      MessageID: 'saved-record-message-id',
      Subject: 'Saved subject',
    });
    const saved = await getInboundEmailById(db, savedResponse.body.id);
    assert.ok(saved);
    assert.equal(saved.provider, 'postmark');
    assert.equal(saved.subject, 'Saved subject');
    assert.equal(saved.fromEmail, 'support@postmarkapp.com');
    assert.equal(saved.toEmail, 'yourhash+SampleHash@inbound.postmarkapp.com');
    assert.equal(saved.processed, false);

    const malformedResponse = await postJson(baseUrl, { unexpected: true });
    assert.equal(malformedResponse.status, 200);
    const malformedSaved = await getInboundEmailById(db, malformedResponse.body.id);
    assert.ok(malformedSaved);
    assert.equal(malformedSaved.subject, '');
    assert.equal(malformedSaved.fromEmail, '');
    assert.equal(malformedSaved.toEmail, '');

    console.log('postmark inbound integration tests passed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    delete process.env.DATABASE_PATH;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
