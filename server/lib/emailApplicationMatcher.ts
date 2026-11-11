import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { applications, contacts, emailApplicationLinks } from '../db/schema.js';
import type { ApplicationMatch, ApplicationMatchResult } from './emailAutomationTypes.js';
import {
  MATCH_AMBIGUITY_GAP,
  MATCH_CONFIDENCE_THRESHOLD,
} from './emailAutomationTypes.js';
import { isUnknownRole } from './emailAutomationMessages.js';

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalize(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalize(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function companyMatchScore(emailCompany: string, appCompany: string): number {
  const a = normalize(emailCompany);
  const b = normalize(appCompany);
  if (!a || !b) return 0;
  if (a === b) return 30;
  if (a.includes(b) || b.includes(a)) return 25;
  return Math.round(tokenOverlap(a, b) * 20);
}

function roleMatchScore(emailRole: string, appRole: string): number {
  const a = normalize(emailRole);
  const b = normalize(appRole);
  if (!a || !b) return 0;
  if (a === b) return 25;
  if (a.includes(b) || b.includes(a)) return 20;
  return Math.round(tokenOverlap(a, b) * 18);
}

function recruiterMatchScore(
  emailRecruiter: string | null,
  contactName: string,
): number {
  if (!emailRecruiter) return 0;
  const a = normalize(emailRecruiter);
  const b = normalize(contactName);
  if (!a || !b) return 0;
  if (a === b) return 15;
  if (a.includes(b) || b.includes(a)) return 12;
  return Math.round(tokenOverlap(a, b) * 10);
}

export interface MatchEmailInput {
  inboundEmailId: string;
  fromEmail: string;
  companyName: string | null;
  positionTitle: string | null;
  recruiterName: string | null;
  /** Used by the booking rule below. */
  classification?: string | null;
  subject?: string | null;
  /** The job seeker's own addresses and name, never a booking's counterparty. */
  ownEmails?: string[];
  ownName?: string | null;
}

// Emails that book or request a meeting with a recruiter you already know.
const BOOKING_CLASSIFICATIONS = new Set(['Scheduling', 'Interview Request']);
const BOOKING_MATCH_CONFIDENCE = 75;
const CLOSED_STATUSES = new Set(['rejected', 'ghosted']);

/**
 * A calendar invite often names only the people: the company is the
 * recruiter's firm and there is no role. When it names, by full name, a
 * contact saved on exactly one open application, that is the application.
 * Two or more such applications: no guess.
 */
function matchBookingByContact(
  input: MatchEmailInput,
  apps: Array<typeof applications.$inferSelect>,
  userContacts: Array<typeof contacts.$inferSelect>,
): ApplicationMatch | null {
  if (!BOOKING_CLASSIFICATIONS.has(input.classification ?? '')) return null;
  const recruiter = normalize(input.recruiterName);
  const subject = ` ${normalize(input.subject)} `;
  // An email that names a role is about that role: the recruiter's other
  // application only counts if its role fits (issue #14).
  const namedRole =
    input.positionTitle && !isUnknownRole(input.positionTitle) ? input.positionTitle : null;
  const openApps = new Map(
    apps
      .filter((app) => !CLOSED_STATUSES.has(app.status))
      .filter((app) => !namedRole || roleMatchScore(namedRole, app.roleTitle) > 0)
      .map((app) => [app.id, app]),
  );

  // Every invite names the job seeker too ("Steve Terapak and …").
  const ownEmails = new Set((input.ownEmails ?? []).map((e) => e.trim().toLowerCase()));
  const ownName = normalize(input.ownName);

  const named = userContacts.filter((contact) => {
    if (!contact.applicationId || !openApps.has(contact.applicationId)) return false;
    const name = normalize(contact.name);
    if (name.split(' ').length < 2) return false;
    if (ownEmails.has(contact.email.trim().toLowerCase()) || (ownName && name === ownName)) {
      return false;
    }
    return name === recruiter || subject.includes(` ${name} `);
  });
  const appIds = new Set(named.map((contact) => contact.applicationId!));
  if (appIds.size !== 1) return null;

  const app = openApps.get([...appIds][0])!;
  return {
    applicationId: app.id,
    company: app.company,
    roleTitle: app.roleTitle,
    status: app.status,
    confidence: BOOKING_MATCH_CONFIDENCE,
    matchReasons: [`Booking with your contact ${named[0].name}`],
  };
}

export function matchEmailToApplications(
  db: Db,
  userId: string,
  input: MatchEmailInput,
): ApplicationMatchResult {
  const apps = db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .all();

  const userContacts = db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .all();

  // A manual link wins. It is resolved against this user's applications only,
  // so a link can never surface another user's application.
  const link = db
    .select({ applicationId: emailApplicationLinks.applicationId })
    .from(emailApplicationLinks)
    .where(
      and(
        eq(emailApplicationLinks.userId, userId),
        eq(emailApplicationLinks.inboundEmailId, input.inboundEmailId),
      ),
    )
    .all()[0];
  const linkedApp = link ? apps.find((app) => app.id === link.applicationId) : undefined;
  if (linkedApp) {
    const linkedMatch: ApplicationMatch = {
      applicationId: linkedApp.id,
      company: linkedApp.company,
      roleTitle: linkedApp.roleTitle,
      status: linkedApp.status,
      confidence: 100,
      matchReasons: ['Linked by you'],
    };
    return {
      matches: [linkedMatch],
      bestMatch: linkedMatch,
      requiresManualSelection: false,
      linkedApplicationId: linkedApp.id,
    };
  }

  const fromEmail = input.fromEmail.trim().toLowerCase();
  const matches: ApplicationMatch[] = [];

  for (const app of apps) {
    const reasons: string[] = [];
    let score = 0;

    const appContacts = userContacts.filter((c) => c.applicationId === app.id);
    const emailContact = appContacts.find(
      (c) => c.email.trim().toLowerCase() === fromEmail,
    );
    if (emailContact) {
      score += 40;
      reasons.push(`Sender email matches contact ${emailContact.name}`);
    }

    if (input.companyName) {
      const companyScore = companyMatchScore(input.companyName, app.company);
      if (companyScore > 0) {
        score += companyScore;
        reasons.push(`Company match: ${app.company}`);
      }
    }

    if (input.positionTitle) {
      const roleScore = roleMatchScore(input.positionTitle, app.roleTitle);
      if (roleScore > 0) {
        score += roleScore;
        reasons.push(`Role match: ${app.roleTitle}`);
      }
    }

    if (input.recruiterName) {
      for (const contact of appContacts) {
        const recruiterScore = recruiterMatchScore(
          input.recruiterName,
          contact.name,
        );
        if (recruiterScore > 0) {
          score += recruiterScore;
          reasons.push(`Recruiter name matches contact ${contact.name}`);
          break;
        }
      }
    }

    const companyScore = input.companyName
      ? companyMatchScore(input.companyName, app.company)
      : 0;
    const roleScore = input.positionTitle
      ? roleMatchScore(input.positionTitle, app.roleTitle)
      : 0;
    if (companyScore >= 25 && roleScore >= 20) {
      score += 15;
      reasons.push('Strong company and role match');
    }

    if (score > 0) {
      matches.push({
        applicationId: app.id,
        company: app.company,
        roleTitle: app.roleTitle,
        status: app.status,
        confidence: Math.min(score, 100),
        matchReasons: reasons,
      });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  const bestMatch = matches[0] ?? null;
  const secondMatch = matches[1] ?? null;
  const requiresManualSelection =
    matches.length > 1 &&
    bestMatch !== null &&
    secondMatch !== null &&
    bestMatch.confidence - secondMatch.confidence < MATCH_AMBIGUITY_GAP;

  const confidentMatch =
    bestMatch && bestMatch.confidence >= MATCH_CONFIDENCE_THRESHOLD && !requiresManualSelection
      ? bestMatch
      : null;

  // Only when the usual signals found nothing confident and nothing ambiguous.
  if (!confidentMatch && !requiresManualSelection) {
    const booking = matchBookingByContact(input, apps, userContacts);
    if (booking) {
      return {
        matches: [booking, ...matches.filter((m) => m.applicationId !== booking.applicationId)],
        bestMatch: booking,
        requiresManualSelection: false,
        linkedApplicationId: null,
      };
    }
  }

  return {
    matches,
    // A single candidate is not exempt from MATCH_CONFIDENCE_THRESHOLD: being
    // the only application scored above zero does not make a weak match (e.g.
    // a sender-email-to-linked-contact hit alone, with no company/role
    // correlation) trustworthy. Requiring the same threshold regardless of
    // matches.length prevents auto-attaching to an unrelated application just
    // because it happened to be the only candidate. See issue #14.
    bestMatch:
      bestMatch && bestMatch.confidence >= MATCH_CONFIDENCE_THRESHOLD && !requiresManualSelection
        ? bestMatch
        : null,
    requiresManualSelection,
    linkedApplicationId: null,
  };
}

export function findDuplicateApplication(
  db: Db,
  userId: string,
  companyName: string | null,
  positionTitle: string | null,
): string | null {
  if (!companyName) return null;
  const apps = db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .all();

  const normalizedCompany = normalize(companyName);
  for (const app of apps) {
    const companyScore = companyMatchScore(companyName, app.company);
    if (companyScore < 20) continue;
    if (positionTitle && !isUnknownRole(positionTitle)) {
      const roleScore = roleMatchScore(positionTitle, app.roleTitle);
      if (roleScore >= 15) return app.id;
      // Both roles known and different: a second application at the same
      // company (e.g. 3 confirmations from one employer), not a duplicate.
      if (!isUnknownRole(app.roleTitle)) continue;
    }
    if (normalize(app.company) === normalizedCompany) {
      return app.id;
    }
    if (companyScore >= 25 && isUnknownRole(app.roleTitle)) {
      return app.id;
    }
  }
  return null;
}
