/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

// "Report a problem" sends the message, the user's email and the page to Slack and, through Postmark, to the
// feedback inbox. The privacy page lists who else handles data, so it must name Slack.
const page = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'PrivacyPage.tsx'), 'utf8');
const text = page.replace(/\s+/g, ' ');

it('privacy page discloses where problem reports go', () => {
  expect(text).toMatch(/Report a problem/);
  expect(text).toMatch(/<strong>Slack<\/strong>/);
  expect(text).toMatch(/feedback inbox/);
});
