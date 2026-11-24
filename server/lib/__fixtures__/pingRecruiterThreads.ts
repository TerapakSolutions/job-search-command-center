/**
 * "Ping recruiter" threads, shaped like the Outlook forwards behind the 2026-11-24 report: the separator line,
 * header order, Sent: format (Pacific local time) and blank lines follow Outlook desktop. Every person, company,
 * address and job is INVENTED; only the timestamps and message shapes come from the report.
 *
 * The job seeker is Jordan Pike <jordan.pike@seeker.example>, who forwards to the app from that address.
 */

export const SEEKER = 'jordan.pike@seeker.example';
export const SEEKER_NAME = 'Jordan Pike';

// True positive. Inbound from the recruiter 2026-10-26 17:56Z; the seeker's
// follow-up 2026-11-10 16:19Z, forwarded 16:20Z; nothing since.
export const TP_RECRUITER = 'lena.ortiz@talent-c.example';
export const tpInbound = `________________________________
From: Lena Ortiz <${TP_RECRUITER}>
Sent: Monday, October 26, 2026 10:56 AM
To: Jordan Pike <${SEEKER}>
Subject: Platform Engineer - Acme Bank


Hi Jordan,

Thanks for your time today. I've shared your profile with the Acme Bank hiring manager and will be in touch with next steps.

Lena
`;

export const tpFollowUpForward = `________________________________
From: Jordan Pike <${SEEKER}>
Sent: Tuesday, November 10, 2026 8:19 AM
To: Lena Ortiz <${TP_RECRUITER}>
Subject: RE: Platform Engineer - Acme Bank


Hi Lena,

Just following up on the Acme Bank Platform Engineer role. Is there any update from the hiring manager?

Thanks,
Jordan

________________________________
From: Lena Ortiz <${TP_RECRUITER}>
Sent: Monday, October 26, 2026 10:56 AM
To: Jordan Pike <${SEEKER}>
Subject: Platform Engineer - Acme Bank


Hi Jordan,

Thanks for your time today. If you're not interested in the role any more, let me know. I've shared your profile with the hiring manager.

Lena
`;

// Sub-bug B. Inbound from vendor A 2026-11-10 21:04Z; the seeker's decline
// 2026-11-10 23:18Z, forwarded.
export const VENDOR_A = 'maya.lund@vendor-a.example';
export const vendorADeclineForward = `________________________________
From: Jordan Pike <${SEEKER}>
Sent: Tuesday, November 10, 2026 3:18 PM
To: Maya Lund <${VENDOR_A}>
Subject: RE: Contract Data Engineer - Globex Insurance


Hi Maya,

Thanks for reaching out. I'm already represented for this Globex Insurance role through another vendor, so please don’t submit my profile for it.

Happy to hear about other roles.

Best,
Jordan

________________________________
From: Maya Lund <${VENDOR_A}>
Sent: Tuesday, November 10, 2026 1:04 PM
To: Jordan Pike <${SEEKER}>
Subject: Contract Data Engineer - Globex Insurance


Hi Jordan,

I have a contract Data Engineer role with Globex Insurance. Are you interested? Please share your updated resume.

Maya
`;

// Sub-bug C. The seeker's question to vendor B 2026-11-13 16:51Z (forwarded);
// vendor B's mass re-send of the same job 2026-11-23 17:42Z, To: himself only
// (the seeker was in Bcc), forwarded.
export const VENDOR_B = 'omar.vance@vendor-b.example';
export const vendorBQuestionForward = `________________________________
From: Jordan Pike <${SEEKER}>
Sent: Friday, November 13, 2026 8:51 AM
To: Omar Vance <${VENDOR_B}>
Subject: RE: Solutions Architect - Initech - Remote


Hi Omar,

Before you submit me: is this role fully remote, and what is the contract length?

Thanks,
Jordan

________________________________
From: Omar Vance <${VENDOR_B}>
Sent: Thursday, November 12, 2026 2:10 PM
To: Jordan Pike <${SEEKER}>
Subject: Solutions Architect - Initech - Remote


Hi Jordan,

Solutions Architect, Initech, remote, 12-month contract. Interested?

Omar
`;

export const vendorBMassResend = `________________________________
From: Omar Vance <${VENDOR_B}>
Sent: Monday, November 23, 2026 9:42 AM
To: Omar Vance <${VENDOR_B}>
Subject: Solutions Architect - Initech - Remote


Hi,

Solutions Architect, Initech, remote, 12-month contract. Interested? Reply with your updated resume.

Omar
`;

// Control for C: a real reply from vendor B, addressed to the seeker.
export const vendorBRealReply = `________________________________
From: Omar Vance <${VENDOR_B}>
Sent: Monday, November 23, 2026 9:42 AM
To: Jordan Pike <${SEEKER}>
Subject: RE: Solutions Architect - Initech - Remote


Hi Jordan,

Yes, fully remote, 12 months with a likely extension.

Omar
`;
