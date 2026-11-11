/** @jest-environment node */
import type { PipelineStatus } from './emailAutomationTypes.js';
import { buildPipelineUpdateProposal } from './emailPipelineAutomation.js';

// A booking (Scheduling) for a recruiter screen must not move the application
// to Interviewing just because the AI flagged "interview detected".
const propose = (currentStatus: PipelineStatus, emailText: string, interviewDetected = true) =>
  buildPipelineUpdateProposal({
    applicationId: 'app-1',
    currentStatus,
    classification: 'Scheduling',
    classificationConfidence: 95,
    interviewDetected,
    emailText,
  })?.proposedStatus ?? null;

// A Google Calendar invite created by Calendly: participant names and a
// generic event name, nothing that says screen or interview.
const GOOGLE_INVITE =
  'Invitation: Steve Terapak and Alex Rivera @ Fri Nov 13, 2026 10:15am - 10:45am (MST)\n' +
  'Steve Terapak and Alex Rivera\nEvent Name\nMeet with Alex\nSent by Google Calendar';

describe('a booking with no screen or interview wording', () => {
  it('keeps an application at Recruiter Screen', () => {
    expect(propose('recruiter_screen', GOOGLE_INVITE)).toBeNull();
  });

  it('moves an applied application only as far as Recruiter Screen', () => {
    expect(propose('applied', GOOGLE_INVITE)).toBe('recruiter_screen');
  });
});

describe('a booking whose title calls it an interview', () => {
  it('keeps a screen at Recruiter Screen (recruiters call screens interviews)', () => {
    expect(
      propose('recruiter_screen', 'Invitation: Interview with Alex Rivera @ Fri Nov 13, 2026 10:15am'),
    ).toBeNull();
  });
});

describe('bookings that are interviews', () => {
  it('an interview confirmation moves Recruiter Screen to Interviewing', () => {
    expect(
      propose(
        'recruiter_screen',
        'Example Co | Interview Confirmation for Engineering Manager\nYour interview is confirmed for July 5, 2026 at 2:00 PM PT.',
      ),
    ).toBe('interviewing');
  });

  it('"Interview confirmed" moves Recruiter Screen to Interviewing', () => {
    expect(propose('recruiter_screen', 'Interview confirmed for the Engineer role')).toBe('interviewing');
  });

  it('a hiring-manager meeting moves Recruiter Screen to Interviewing', () => {
    expect(
      propose('recruiter_screen', 'Invitation: Steve Terapak and Jane Doe (hiring manager) @ Fri Nov 20, 2026 1pm'),
    ).toBe('interviewing');
  });
});

describe('a booking that names a screening', () => {
  it('stays a screen', () => {
    expect(propose('applied', 'Confirmed: 30 Minute Initial Zoom Screening with Alex Rivera')).toBe(
      'recruiter_screen',
    );
  });
});
