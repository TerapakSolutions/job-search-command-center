import { computeReminders } from './reminders';
import type { Application } from '../types/application';
import type { Contact } from '../types/contact';
import type { Interview } from '../types/interview';

const baseApp = (overrides: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Acme',
  roleTitle: 'Engineer',
  jobUrl: '',
  workLocationType: 'remote',
  location: '',
  salaryMin: null,
  salaryMax: null,
  dateApplied: null,
  status: 'saved',
  notes: '',
  interviewDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('computeReminders', () => {
  const now = new Date('2026-06-30T12:00:00.000Z');

  // Steve, 2026-10-26: reminders are for recruiters; a plain application
  // (applied, waiting) has nothing to act on, however long it has been.
  it.each([
    ['7+ days', '2026-06-20'],
    ['30+ days', '2026-05-01'],
  ])('creates no reminder for an application applied %s ago', (_label, dateApplied) => {
    const apps = [
      baseApp({
        status: 'applied',
        dateApplied,
        createdAt: `${dateApplied}T00:00:00.000Z`,
        updatedAt: `${dateApplied}T00:00:00.000Z`,
      }),
    ];
    expect(computeReminders(apps, [], now)).toEqual([]);
  });

  it('creates recruiter ping after 3 business days', () => {
    const apps = [baseApp({ status: 'recruiter_screen' })];
    const contacts: Contact[] = [
      {
        id: 'c-1',
        applicationId: 'app-1',
        name: 'Recruiter',
        email: '',
        linkedIn: '',
        company: 'Acme',
        source: 'manual',
        lastContactDate: '2026-06-25',
        messageNotes: '',
        nextAction: '',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const reminders = computeReminders(apps, contacts, now);
    expect(reminders.some((r) => r.type === 'recruiter_no_reply')).toBe(true);
  });

  it('creates interview prep when interview is within 3 days', () => {
    const apps = [
      baseApp({
        status: 'interviewing',
        interviewDate: '2026-07-01',
      }),
    ];
    const reminders = computeReminders(apps, [], now);
    expect(reminders.some((r) => r.type === 'interview_prep')).toBe(true);
  });

  it('creates stale review for old saved applications', () => {
    const apps = [
      baseApp({
        status: 'saved',
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
    ];
    const reminders = computeReminders(apps, [], now);
    expect(reminders.some((r) => r.type === 'stale_review')).toBe(true);
  });
});

// Steve, 2026-10-27: once today's interview is over, "Prep for interview ...
// Interview is today" should go away.
describe('interview prep after the interview', () => {
  // Local-time constructors keep these independent of the machine's zone.
  const NINE_PM = new Date(2026, 9, 27, 21, 0);
  const app = baseApp({ status: 'interviewing', interviewDate: '2026-10-27' });
  const interviewAt = (scheduled: Date): Interview => ({
    id: 'int-1',
    applicationId: 'app-1',
    scheduledAt: scheduled.toISOString(),
    type: 'video',
    location: '',
    notes: '',
    createdAt: '',
    updatedAt: '',
  });
  const hasPrep = (interviews: Interview[]) =>
    computeReminders([app], [], NINE_PM, interviews).some((r) => r.type === 'interview_prep');

  it('drops the prep reminder once the interview time has passed', () => {
    expect(hasPrep([interviewAt(new Date(2026, 9, 27, 14, 0))])).toBe(false);
  });

  it('keeps it while the interview is still ahead today (control)', () => {
    expect(hasPrep([interviewAt(new Date(2026, 9, 27, 22, 30))])).toBe(true);
  });

  it('keeps it when only the date is known (control)', () => {
    expect(hasPrep([])).toBe(true);
  });

  it('ignores a past interview on another day', () => {
    expect(hasPrep([interviewAt(new Date(2026, 9, 20, 14, 0))])).toBe(true);
  });
});
