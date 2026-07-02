import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { applications, contacts } from '../db/schema.js';
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
  fromEmail: string;
  companyName: string | null;
  positionTitle: string | null;
  recruiterName: string | null;
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

  return {
    matches,
    bestMatch:
      bestMatch && bestMatch.confidence >= MATCH_CONFIDENCE_THRESHOLD && !requiresManualSelection
        ? bestMatch
        : bestMatch && matches.length === 1
          ? bestMatch
          : null,
    requiresManualSelection,
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
