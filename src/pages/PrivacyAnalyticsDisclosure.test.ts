/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

// GA4 (src/lib/analytics.ts) uses analytics cookies: Consent Mode grants
// analytics_storage by default, except in the EEA, UK and Switzerland, where a
// region-specific default denies it (Steve 2026-10-29, option A: cookieless
// pings showed 0 users in Realtime). The privacy page must say so, and must
// never again claim there are no analytics or no cookies.
const page = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'PrivacyPage.tsx'), 'utf8');
const analytics = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'analytics.ts'), 'utf8');
const text = page.replace(/\s+/g, ' ');

describe('privacy page discloses Google Analytics', () => {
  it('no longer claims there are no analytics or tracking scripts', () => {
    expect(text).not.toMatch(/no analytics or tracking scripts/i);
  });

  it('names Google Analytics, discloses its _ga cookies and the EU/UK/CH carve-out', () => {
    expect(text).toMatch(/Google Analytics/);
    expect(text).toMatch(/sets its own cookies \(_ga\)/);
    expect(text).toMatch(/EU, UK and Switzerland get no analytics cookies/);
    expect(text).toMatch(/what you type/i);
  });

  it('no longer claims Google Analytics uses no cookies', () => {
    expect(text).not.toMatch(/no cookies/i);
    expect(text).not.toMatch(/without cookies/i);
    expect(text).not.toMatch(/the only cookie/i);
  });

  it('lists Google Analytics among who else handles your data', () => {
    const section = text.slice(text.indexOf('Who else handles your data'), text.indexOf('AI processing'));
    expect(section).toMatch(/Google Analytics/);
    expect(section).toMatch(/with its own cookies but no personal data/);
  });

  it('CONTROL: the code grants analytics_storage globally, denies it by region first', () => {
    const consentCalls = [...analytics.matchAll(/gtag\('consent',\s*'default',\s*([A-Z_]+)\)/g)].map((m) => m[1]);
    expect(consentCalls).toHaveLength(2);
    const [regionName, globalName] = consentCalls;
    const body = (name: string) => {
      const m = analytics.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\}`));
      return m ? m[1] : '';
    };
    expect(body(regionName)).toMatch(/analytics_storage:\s*'denied'/);
    expect(body(regionName)).toMatch(/region:/);
    expect(body(globalName)).toMatch(/analytics_storage:\s*'granted'/);
    expect(body(globalName)).not.toMatch(/region:/);
    const regions = analytics.match(/ANALYTICS_COOKIE_DENIED_REGIONS = \[([^\]]*)\]/)?.[1] ?? '';
    for (const code of ['DE', 'FR', 'GB', 'CH', 'NO']) expect(regions).toMatch(new RegExp(`'${code}'`));
    expect(analytics).not.toMatch(/ad_(storage|user_data|personalization)['"]?\s*:\s*['"]granted/);
  });
});
