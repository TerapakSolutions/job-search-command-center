/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

// GA4 ships with this branch (src/lib/analytics.ts), cookieless: Consent Mode
// defaults every storage signal to denied and nothing grants it (Steve
// 2026-10-29: "No cookies then if possible"). The privacy page must say so —
// and must never again claim there are no analytics.
const page = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'PrivacyPage.tsx'), 'utf8');
const analytics = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'analytics.ts'), 'utf8');
const text = page.replace(/\s+/g, ' ');

describe('privacy page discloses Google Analytics', () => {
  it('no longer claims there are no analytics or tracking scripts', () => {
    expect(text).not.toMatch(/no analytics or tracking scripts/i);
  });

  it('names Google Analytics and says it sets no cookies and sends no personal data', () => {
    expect(text).toMatch(/Google Analytics/);
    expect(text).toMatch(/no cookies/i);
    expect(text).toMatch(/what you type/i);
  });

  it('lists Google Analytics among who else handles your data', () => {
    const section = text.slice(text.indexOf('Who else handles your data'), text.indexOf('AI processing'));
    expect(section).toMatch(/Google Analytics/);
  });

  it('CONTROL: the code really is cookieless — analytics_storage defaults to denied', () => {
    expect(analytics).toMatch(/analytics_storage/);
    expect(analytics).not.toMatch(/analytics_storage['"]?\s*:\s*['"]granted/);
  });
});
