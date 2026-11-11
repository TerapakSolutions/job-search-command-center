/**
 * Real Outlook forward of a Google Calendar invitation created by Calendly,
 * captured from prod (2026-11-11), redacted: recruiter, recruiting firm,
 * phone numbers, meeting codes, Calendly ids and tracking tokens replaced.
 * Line structure, separators, header order and the Google/Calendly
 * boilerplate are as captured.
 *
 * Note the three times: the subject says 10:15am (MST); Outlook's "When:"
 * line restates it in the forwarder's own zone without saying which; Google's
 * "When" names a zone ("Mountain Time - Denver") but no abbreviation.
 */
export const GOOGLE_INVITE_SUBJECT =
  'Fw: Invitation: Steve Terapak and Alex Rivera @ Fri Nov 13, 2026 10:15am - 10:45am (MST) (steve@terapak.com)';

export const GOOGLE_INVITE_RECRUITER = 'Alex Rivera';
export const GOOGLE_INVITE_SENDER = 'alex@talentfirm.example';
/** 10:15am MST */
export const GOOGLE_INVITE_START = '2026-11-13T17:15:00.000Z';

export const googleCalendarInvite = `

Steve Terapak
555-0100
terapak.com<https://www.terapak.com>



________________________________
From: Alex Rivera <alex@talentfirm.example>
Sent: Wednesday, November 11, 2026 8:26 AM
To: Steve Terapak <steve@terapak.com>
Subject: Invitation: Steve Terapak and Alex Rivera @ Fri Nov 13, 2026 10:15am - 10:45am (MST) (steve@terapak.com)
When: Friday, November 13, 2026 9:15 AM-9:45 AM.
Where: Google Meet (instructions in description); https://meet.google.com/aaa-bbbb-ccc

Steve Terapak and Alex Rivera
Join with Google Meet – Event Name Meet with Alex Location: This is a Google Meet web conference. You can join this meeting from your computer, tablet, or smartphone. https://calendly.com/events/00000000-0000-4000-8000-0000

Join with Google Meet<https://meet.google.com/aaa-bbbb-ccc?hs=224>
Meeting link
meet.google.com/aaa-bbbb-ccc<https://meet.google.com/aaa-bbbb-ccc?hs=224>
Join by phone
(US) +1 555-0142<tel:+1-555-0142%3B000000000%23>
PIN: 000000000

More phone numbers<https://tel.meet/aaa-bbbb-ccc?pin=0000000000000&hs=0>
Event Name
Meet with Alex

Location: This is a Google Meet web conference.
You can join this meeting from your computer, tablet, or smartphone.
https://calendly.com/events/00000000-0000-4000-8000-000000000000/google_meet<https://www.google.com/url?q=https%3A%2F%2Fcalendly.com%2Fevents%2F00000000-0000-4000-8000-000000000000%2Fgoogle_meet&sa=D&source=calendar&ust=0&usg=REDACTED>

Please share a link to your LinkedIn profile or resume:
https://www.linkedin.com/example<https://www.google.com/url?q=https%3A%2F%2Fcalendly.com%2Furl%3Fq%3Dhttps%253A%252F%252Fwww.linkedin.com%252Fexample&sa=D&source=calendar&ust=0&usg=REDACTED>
https://www.terapak.com<https://www.google.com/url?q=https%3A%2F%2Fcalendly.com%2Furl%3Fq%3Dhttps%253A%252F%252Fwww.terapak.com&sa=D&source=calendar&ust=0&usg=REDACTED>

Need to make changes to this event?
Cancel: https://calendly.com/cancellations/11111111-1111-4111-8111-111111111111<https://www.google.com/url?q=https%3A%2F%2Fcalendly.com%2Fcancellations%2F11111111-1111-4111-8111-111111111111&sa=D&source=calendar&ust=0&usg=REDACTED>
Reschedule: https://calendly.com/reschedulings/11111111-1111-4111-8111-111111111111<https://www.google.com/url?q=https%3A%2F%2Fcalendly.com%2Freschedulings%2F11111111-1111-4111-8111-111111111111&sa=D&source=calendar&ust=0&usg=REDACTED>

Powered by Calendly.com

When
Friday Nov 13, 2026 ⋅ 10:15am – 10:45am (Mountain Time - Denver)
Location
Google Meet (instructions in description)
View map<https://www.google.com/maps/search/Google+Meet+%28instructions+in+description%29?hl=en>
Guests
Alex Rivera<mailto:alex@talentfirm.example> - organizer
steve@terapak.com<mailto:steve@terapak.com>
View all guest info<https://calendar.google.com/calendar/event?action=VIEW&eid=REDACTED&tok=REDACTED&ctz=America%2FDenver&hl=en&es=0>
Reply for steve@terapak.com<mailto:steve@terapak.com>
Yes<https://calendar.google.com/calendar/event?action=RESPOND&eid=REDACTED&rst=1&tok=REDACTED&ctz=America%2FDenver&hl=en&es=0>
No<https://calendar.google.com/calendar/event?action=RESPOND&eid=REDACTED&rst=2&tok=REDACTED&ctz=America%2FDenver&hl=en&es=0>
Maybe<https://calendar.google.com/calendar/event?action=RESPOND&eid=REDACTED&rst=3&tok=REDACTED&ctz=America%2FDenver&hl=en&es=0>
More options<https://calendar.google.com/calendar/event?action=VIEW&eid=REDACTED&tok=REDACTED&ctz=America%2FDenver&hl=en&es=0>

Sent by Google Calendar<https://calendar.google.com/calendar/>

You are receiving this email because you are an attendee on the event.

Forwarding this invitation could allow any recipient to send a response to the organizer, be added to the guest list, invite others regardless of their own invitation status, or modify your RSVP. Learn more<https://support.google.com/calendar/answer/37135#forwarding>
`;
