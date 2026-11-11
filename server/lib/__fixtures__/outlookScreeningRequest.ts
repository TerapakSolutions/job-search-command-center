/**
 * Real Outlook forward captured from prod (2026-11-11), redacted: company,
 * recruiter, domains and the scheduling link replaced. Separators, blank
 * lines and header order are kept as captured; the signature was trimmed.
 *
 * A recruiter asks for a 30-minute initial screening and sends a Calendly
 * link. No time is booked yet.
 */
export const SCREENING_REQUEST_SUBJECT = 'Fw: Example Grocer Interview Request';

export const SCREENING_CALENDLY_URL = 'https://calendly.com/example-talent';

export const outlookScreeningRequest = `

________________________________
From: Alex Rivera <alex.rivera@examplegrocer.example>
Sent: Tuesday, November 10, 2026 10:33 PM
To: Steve Terapak <steve@terapak.com>
Subject: Example Grocer Interview Request

Stephen,

Thank you so much for your interest in the Senior Engineering Manager, DC Buying role with Example Grocer! We've had a chance to review your application, and we're impressed with your background. We would love to schedule a 30-minute initial Zoom screening call to learn more about your experience and share a bit more about what we're building here at Example Grocer.

To schedule your next interview(s), please select a time through the Calendly link below.

${SCREENING_CALENDLY_URL}

In the meantime, learn more about Example Grocer.<https://www.examplegrocer.example/>

Regards,
Alex
`;

/** The booking confirmation that follows once a screening slot is picked. */
export const CALENDLY_CONFIRMATION_SUBJECT =
  'Fw: Confirmed: 30 Minute Initial Zoom Screening with Alex Rivera on Thursday, November 12, 2026';

export const calendlyScreeningConfirmation = `

________________________________
From: Calendly <notifications@calendly.com>
Sent: Wednesday, November 11, 2026 9:02 AM
To: Steve Terapak <steve@terapak.com>
Subject: Confirmed: 30 Minute Initial Zoom Screening with Alex Rivera on Thursday, November 12, 2026

Hi Steve,

A new event has been scheduled.

Event Type:
30 Minute Initial Zoom Screening

Invitee:
Steve Terapak

Event Date/Time:
10:00am - Thursday, November 12, 2026 (Pacific Time - US & Canada)

Location:
This is a Zoom web conference.
`;

/** A hiring-team interview, which should still go to Interviewing. */
export const hiringManagerInterview = `
Hi Steve,

Thanks for your time last week. We'd like to schedule a 45-minute interview with Jane, our VP of Engineering, to go deeper on your leadership experience. Please send a few times that work for you.

Thanks,
Alex
`;

/**
 * The recruiter's next reply in the same thread: a hiring-team round, with
 * the earlier screening request quoted underneath (as Outlook sends it).
 */
export const NEXT_ROUND_SUBJECT = 'Fw: RE: Example Grocer Interview Request';

export const outlookNextRoundReply = `

________________________________
From: Alex Rivera <alex.rivera@examplegrocer.example>
Sent: Monday, November 16, 2026 9:12 AM
To: Steve Terapak <steve@terapak.com>
Subject: RE: Example Grocer Interview Request

Hi Steve,

Great speaking with you! Next step is a 60-minute interview with Sam and Priya from the product team. Please pick a time that works for you.

Regards,
Alex

________________________________
From: Alex Rivera <alex.rivera@examplegrocer.example>
Sent: Tuesday, November 10, 2026 10:33 PM
To: Steve Terapak <steve@terapak.com>
Subject: Example Grocer Interview Request

Stephen,

We would love to schedule a 30-minute initial Zoom screening call to learn more about your experience.

${SCREENING_CALENDLY_URL}
`;
