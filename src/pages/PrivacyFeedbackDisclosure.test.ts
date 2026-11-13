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

it('"What is stored" lists problem reports, and the profile line no longer says "only to sign you in"', () => {
  const start = text.indexOf('title="What is stored"');
  const end = text.indexOf('title="Where it is stored');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const stored = text.slice(start, end);
  expect(stored).toMatch(/Problem reports/);
  expect(stored).toMatch(/your email address/);
  expect(stored).toMatch(/browser and device details/);
  // The Google-profile line must no longer say the email is used ONLY to sign in.
  expect(text).not.toMatch(/used only to sign you in/);
});
