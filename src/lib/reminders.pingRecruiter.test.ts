import { computeReminders, followedUpContactDate } from './reminders';
import { businessDaysBetween, parseDate } from './dates';
import type { Application } from '../types/application';
import type { Contact } from '../types/contact';

// Shapes from the 2026-11-24 "Ping recruiter" report; every identity invented.

const app = (overrides: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Acme Bank',
  roleTitle: 'Platform Engineer',
  jobUrl: '',
  workLocationType: 'remote',
  location: '',
  salaryMin: null,
  salaryMax: null,
  dateApplied: null,
  status: 'recruiter_screen',
  notes: '',
  interviewDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 'c-1',
  applicationId: 'app-1',
  name: 'Lena Ortiz',
  email: 'lena.ortiz@talent-c.example',
  linkedIn: '',
  company: 'Talent C',
  source: 'email',
  lastContactDate: '2026-11-10',
  messageNotes: '',
  nextAction: '',
  declineDetectedAt: null,
  threadClosedAt: null,
  threadKeptOpenAt: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

// Local Pacific noon (CI runs under TZ=America/Los_Angeles).
const at = (day: string) => new Date(`${day}T12:00:00`);
const types = (day: string, apps: Application[], cs: Contact[]) =>
  computeReminders(apps, cs, at(day)).map((r) => r.type);

describe('AC4: the true positive still nudges', () => {
  it('pings 11-24 after your 11-10 follow-up with no reply since', () => {
    const [r] = computeReminders([app()], [contact()], at('2026-11-24'));
    expect(r.type).toBe('recruiter_no_reply');
    expect(r.contactId).toBe('c-1');
    expect(r.description).toBe('No reply in 10 business days (Lena Ortiz).');
  });
});

describe('AC1: "I followed up" restarts the clock', () => {
  it('moves the contact date to the local day of the click', () => {
    // 11-24 17:30 Pacific is already 11-25 in UTC: the local day must win.
    expect(followedUpContactDate('2026-11-10', new Date('2026-11-25T01:30:00.000Z'))).toBe('2026-11-24');
  });

  it('never moves the date backwards', () => {
    expect(followedUpContactDate('2026-11-25', at('2026-11-24'))).toBeNull();
    expect(followedUpContactDate('2026-11-24', at('2026-11-24'))).toBeNull();
  });

  it('removes the nudge, which returns only 3 business days after the click', () => {
    const clicked = followedUpContactDate('2026-11-10', at('2026-11-24'))!;
    const after = [contact({ lastContactDate: clicked })];
    expect(types('2026-11-24', [app()], after)).toEqual([]);
    expect(types('2026-11-26', [app()], after)).toEqual([]);
    // Holidays count as business days (see dates.ts): Tue + Wed, Thanksgiving, Fri = 3.
    expect(types('2026-11-27', [app()], after)).toEqual(['recruiter_no_reply']);
  });
});

describe('Fixture A: a follow-up sent by direct reply, logged with "I followed up"', () => {
  it('11-11 inbound, click 11-19 19:08Z: quiet 11-20 and 11-23, nudges again Mon 11-24', () => {
    const clicked = followedUpContactDate('2026-11-11', new Date('2026-11-19T19:08:00.000Z'));
    expect(clicked).toBe('2026-11-19');
    const cs = [contact({ lastContactDate: clicked })];
    expect(types('2026-11-20', [app()], cs)).toEqual([]);
    expect(types('2026-11-23', [app()], cs)).toEqual([]);
    // Correct under N=3: 3 business days after the follow-up.
    expect(types('2026-11-24', [app()], cs)).toEqual(['recruiter_no_reply']);
  });
});

describe('AC3: a declined vendor thread', () => {
  const declined = contact({
    id: 'c-a',
    name: 'Maya Lund',
    email: 'maya.lund@vendor-a.example',
    company: 'Vendor A',
    declineDetectedAt: '2026-11-10T23:18:37.000Z',
  });

  it('asks to close the thread instead of pinging the vendor', () => {
    const reminders = computeReminders([app({ company: 'Globex Insurance' })], [declined], at('2026-11-24'));
    expect(reminders.map((r) => [r.type, r.title, r.contactId])).toEqual([
      ['close_thread', 'Close thread: Globex Insurance via Vendor A (you declined)?', 'c-a'],
    ]);
  });

  it('names the vendor by its domain when the contact has no company', () => {
    const [r] = computeReminders([app({ company: 'Globex Insurance' })], [{ ...declined, company: '' }], at('2026-11-24'));
    expect(r.title).toBe('Close thread: Globex Insurance via vendor-a.example (you declined)?');
  });

  it('fires nothing for that recruiter once the close is confirmed', () => {
    const closed = { ...declined, threadClosedAt: '2026-11-24T20:00:00.000Z' };
    expect(types('2026-11-24', [app()], [closed])).toEqual([]);
    expect(types('2026-12-24', [app()], [closed])).toEqual([]);
  });

  it('a closed thread stays quiet even with no decline flag on it', () => {
    const closed = { ...declined, declineDetectedAt: null, threadClosedAt: '2026-11-24T20:00:00.000Z' };
    expect(types('2026-12-24', [app()], [closed])).toEqual([]);
  });
});

describe('B(3): several vendors on one company', () => {
  const secondary = contact({
    id: 'c-a',
    name: 'Maya Lund',
    email: 'maya.lund@vendor-a.example',
    company: 'Vendor A',
    lastContactDate: '2026-11-10',
    messageNotes: '[2026-11-10] Secondary vendor: you are already submitted for this role via Vendor C. Saved for other roles.',
  });
  const represented = contact({
    id: 'c-c',
    name: 'Ravi Shah',
    email: 'ravi.shah@vendor-c.example',
    company: 'Vendor C',
    lastContactDate: '2026-11-20',
  });

  it('does not ping a secondary vendor, the only contact on the role (the prod B row)', () => {
    expect(types('2026-11-24', [app({ agency: 'Vendor C' })], [secondary])).toEqual([]);
  });

  it('times the nudge from the vendor you are represented by, not the stale thread', () => {
    const apps = [app({ agency: 'Vendor C' })];
    expect(types('2026-11-24', apps, [secondary, represented])).toEqual([]);
    const [r] = computeReminders(apps, [secondary, represented], at('2026-11-25'));
    expect([r.type, r.contactId]).toEqual(['recruiter_no_reply', 'c-c']);
  });

  it('prefers the agency-of-record contact even when another open vendor is more recent', () => {
    const other = contact({ id: 'c-d', name: 'Ann Bell', email: 'ann@vendor-d.example', company: 'Vendor D', lastContactDate: '2026-11-23' });
    const [r] = computeReminders([app({ agency: 'Vendor C' })], [other, represented], at('2026-11-25'));
    expect([r.type, r.contactId, r.description]).toEqual(['recruiter_no_reply', 'c-c', 'No reply in 3 business days (Ravi Shah).']);
  });
});

describe('agency preference and Keep open', () => {
  const agency = { agency: 'Vendor C' };
  const c = (id: string, company: string, over: Partial<Contact> = {}) =>
    contact({ id, company, name: id, email: `${id}@mail.example`, ...over });
  const pinged = (a: Application, cs: Contact[]) =>
    computeReminders([a], cs, at('2026-11-24')).filter((r) => r.type === 'recruiter_no_reply').map((r) => r.contactId);

  it('"Keep open" resumes nudges despite the secondary-vendor note', () => {
    const note = { messageNotes: 'Secondary vendor: x' };
    expect(pinged(app(agency), [c('a', 'Vendor A', note)])).toEqual([]);
    expect(pinged(app(agency), [c('a', 'Vendor A', { ...note, threadKeptOpenAt: '2026-11-20T00:00:00.000Z' })])).toEqual(['a']);
  });

  it('an agency contact with no date does not suppress the nudge', () => {
    expect(pinged(app(agency), [c('rep', 'Vendor C', { lastContactDate: null }), c('d', 'Vendor D')])).toEqual(['d']);
  });

  it.each([
    ['closed', { threadClosedAt: '2026-11-20T00:00:00.000Z' }],
    ['declined', { declineDetectedAt: '2026-11-20T00:00:00.000Z' }],
  ])('a %s agency thread does not fall back to another vendor', (_l, over) => {
    expect(pinged(app(agency), [c('rep', 'Vendor C', over), c('d', 'Vendor D')])).toEqual([]);
  });

  describe('a contact outside the vendors still resets the clock', () => {
    const rep = c('rep', 'Vendor C');
    const recent = { lastContactDate: '2026-11-23' };
    it.each([
      ['at the client, by company', c('hm', 'Acme Bank', recent)],
      ['at the client, by email domain', c('hm', 'Something Else', { ...recent, email: 'hm@acmebank.example' })],
      ['at the client under a longer name', c('hm', 'Acme Bank N.A.', recent)],
      ['with no company (cannot tell)', c('hm', '', recent)],
    ])('%s', (_l, person) => expect(pinged(app(agency), [rep, person])).toEqual([]));

    it('but another vendor does not, and the ping always names the agency contact', () => {
      expect(pinged(app(agency), [rep, c('d', 'Vendor D', recent)])).toEqual(['rep']);
      expect(pinged(app(agency), [rep, c('hm', 'Acme Bank', { lastContactDate: '2026-11-12' })])).toEqual(['rep']);
    });

    it('a closed or declined client contact does not', () => {
      for (const over of [{ threadClosedAt: 'x' }, { declineDetectedAt: 'x' }]) {
        expect(pinged(app(agency), [rep, c('hm', 'Acme Bank', { ...recent, ...over })])).toEqual(['rep']);
      }
    });
  });

  it('matches the whole domain label, not a substring', () => {
    const sub = c('x', 'Tekstaff', { email: 'x@tekstaff.example', lastContactDate: '2026-11-23' });
    const rep = c('rep', '', { email: 'rep@tek.example' });
    expect(pinged(app({ agency: 'TEK, Inc.' }), [sub, rep])).toEqual(['rep']);
  });
});

describe('Thanksgiving: holidays count as business days', () => {
  it('counts Thu 11-26 and Fri 11-27 (Wed 11-25 to Mon 11-30 is 3)', () => {
    expect(businessDaysBetween(parseDate('2026-11-25')!, parseDate('2026-11-30')!)).toBe(3);
  });

  it('no nudge Fri 11-27, nudge Mon 11-30 after a Wed 11-25 contact', () => {
    const cs = [contact({ lastContactDate: '2026-11-25' })];
    expect(types('2026-11-27', [app()], cs)).toEqual([]);
    expect(types('2026-11-30', [app()], cs)).toEqual(['recruiter_no_reply']);
  });
});
