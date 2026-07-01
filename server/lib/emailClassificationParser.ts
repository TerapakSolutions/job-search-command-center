import {
  EMAIL_CLASSIFICATIONS,
  type EmailClassification,
  type EmailClassificationResult,
} from './emailClassificationTypes.js';

function normalizeClassification(value: unknown): EmailClassification {
  if (typeof value !== 'string') return 'Other';
  const match = EMAIL_CLASSIFICATIONS.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? 'Other';
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n <= 1) return Math.round(Math.max(0, Math.min(1, n)) * 100);
  return Math.round(Math.max(0, Math.min(100, n)));
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function defaultSuggestedAction(
  classification: EmailClassification,
): string {
  switch (classification) {
    case 'Interview Request':
      return 'Reply to schedule the interview';
    case 'Application Confirmation':
      return 'No action needed — application received';
    case 'Rejection':
      return 'Archive the application and move on';
    case 'Offer':
      return 'Review offer details and respond promptly';
    case 'Follow-up Required':
      return 'Send a follow-up reply';
    case 'Scheduling':
      return 'Confirm or propose interview times';
    case 'Recruiter Outreach':
      return 'Review opportunity and respond if interested';
    default:
      return 'Review email and decide next steps';
  }
}

export function parseClassificationJson(
  raw: string,
): EmailClassificationResult | null {
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const classification = normalizeClassification(json.classification);
    const suggestedAction =
      typeof json.suggestedAction === 'string' && json.suggestedAction.trim()
        ? json.suggestedAction.trim()
        : defaultSuggestedAction(classification);

    return {
      classification,
      classificationConfidence: clampConfidence(json.classificationConfidence),
      companyName:
        typeof json.companyName === 'string' && json.companyName.trim()
          ? json.companyName.trim()
          : null,
      positionTitle:
        typeof json.positionTitle === 'string' && json.positionTitle.trim()
          ? json.positionTitle.trim()
          : null,
      recruiterName:
        typeof json.recruiterName === 'string' && json.recruiterName.trim()
          ? json.recruiterName.trim()
          : null,
      requiresResponse: Boolean(json.requiresResponse),
      suggestedAction,
      actionDueAt: parseIsoDate(json.actionDueAt),
      interviewDetected: Boolean(json.interviewDetected),
      interviewDatetime: parseIsoDate(json.interviewDatetime),
      aiSummary:
        typeof json.aiSummary === 'string' && json.aiSummary.trim()
          ? json.aiSummary.trim()
          : suggestedAction,
    };
  } catch {
    return null;
  }
}
