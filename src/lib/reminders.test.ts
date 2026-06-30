import { computeReminders } from './reminders';
import type { Application } from '../types/application';
import type { Contact } from '../types/contact';

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

  it('creates follow-up when applied 7+ days ago with no contacts', () => {
    const apps = [
      baseApp({
        status: 'applied',
        dateApplied: '2026-06-20',
      }),
    ];
    const reminders = computeReminders(apps, [], now);
    expect(reminders.some((r) => r.type === 'follow_up_applied')).toBe(true);
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
