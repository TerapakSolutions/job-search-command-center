import type { ApplicationMatch } from './emailAutomationTypes.js';
import { PIPELINE_AUTO_CONFIDENCE_THRESHOLD } from './emailAutomationTypes.js';

export const APPROVAL_TYPES = [
  'no_matching_application',
  'multiple_matching_applications',
  'low_ai_confidence',
  'pipeline_update',
  'interview_detected',
  'offer_detected',
  'salary_negotiation_detected',
  'manual_review_required',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_REASON_CODES = [
  'low_confidence_classification',
  'ambiguous_application_match',
  'no_application_match',
  'offer',
  'salary_negotiation',
  'interview_scheduling',
  'protected_pipeline_status',
  'requires_response',
  'recruiter_without_application',
  'duplicate_application_ambiguous',
  'pipeline_update_low_confidence',
] as const;

export type ApprovalReasonCode = (typeof APPROVAL_REASON_CODES)[number];

export interface ApprovalReasonDetails {
  approvalType: ApprovalType;
  reasonCode: ApprovalReasonCode | string;
  reasonMessage: string;
  aiConfidence: number;
  suggestedAction: string;
  autoApprovalThreshold: number;
  candidateMatches?: ApplicationMatch[];
  stopReason: string;
}

export function approvalTypeLabel(type: ApprovalType | string): string {
  switch (type) {
    case 'no_matching_application':
      return 'No matching application';
    case 'multiple_matching_applications':
      return 'Multiple matching applications';
    case 'low_ai_confidence':
      return 'Low AI confidence';
    case 'pipeline_update':
      return 'Pipeline update approval';
    case 'interview_detected':
      return 'Interview detected';
    case 'offer_detected':
      return 'Offer detected';
    case 'salary_negotiation_detected':
      return 'Salary negotiation detected';
    case 'manual_review_required':
      return 'Manual review required';
    default:
      return type.replace(/_/g, ' ');
  }
}

export function reasonCodeMessage(code: string): string {
  switch (code) {
    case 'low_confidence_classification':
      return 'AI classification confidence is below the auto-approval threshold.';
    case 'ambiguous_application_match':
      return 'Multiple applications match this email — confirm which one to use.';
    case 'no_application_match':
      return 'No existing application matches this email.';
    case 'offer':
      return 'An offer was detected — pipeline changes need your confirmation.';
    case 'salary_negotiation':
      return 'Salary or compensation terms were detected — review before acting.';
    case 'interview_scheduling':
      return 'Interview scheduling was detected — confirm pipeline and next steps.';
    case 'protected_pipeline_status':
      return 'The current pipeline stage is protected and requires approval to change.';
    case 'requires_response':
      return 'This email may require a reply before automation can continue.';
    case 'recruiter_without_application':
      return 'A recruiter was detected but no application is linked yet.';
    case 'duplicate_application_ambiguous':
      return 'A similar application exists — confirm whether to link this email.';
    case 'pipeline_update_low_confidence':
      return 'Pipeline update confidence is below the auto-approval threshold.';
    default:
      return code.replace(/_/g, ' ');
  }
}

export function resolveApprovalType(input: {
  legacyApprovalType: string;
  reasonCodes: string[];
}): ApprovalType {
  const codes = new Set(input.reasonCodes);
  if (input.legacyApprovalType === 'create_application_suggestion') {
    return 'no_matching_application';
  }
  if (input.legacyApprovalType === 'link_application') {
    return 'multiple_matching_applications';
  }
  if (input.legacyApprovalType === 'draft_reply' || codes.has('requires_response')) {
    return 'manual_review_required';
  }
  if (input.legacyApprovalType === 'create_contact' || codes.has('recruiter_without_application')) {
    return 'no_matching_application';
  }
  if (codes.has('offer')) return 'offer_detected';
  if (codes.has('salary_negotiation')) return 'salary_negotiation_detected';
  if (codes.has('interview_scheduling')) return 'interview_detected';
  if (codes.has('low_confidence_classification') || codes.has('pipeline_update_low_confidence')) {
    return 'low_ai_confidence';
  }
  if (codes.has('ambiguous_application_match')) {
    return 'multiple_matching_applications';
  }
  if (input.legacyApprovalType === 'pipeline_update') {
    return 'pipeline_update';
  }
  return 'manual_review_required';
}

export function resolvePrimaryReasonCode(reasonCodes: string[]): ApprovalReasonCode | string {
  const priority: ApprovalReasonCode[] = [
    'offer',
    'salary_negotiation',
    'interview_scheduling',
    'ambiguous_application_match',
    'low_confidence_classification',
    'protected_pipeline_status',
    'requires_response',
    'no_application_match',
    'recruiter_without_application',
    'duplicate_application_ambiguous',
    'pipeline_update_low_confidence',
  ];
  for (const code of priority) {
    if (reasonCodes.includes(code)) return code;
  }
  return reasonCodes[0] ?? 'manual_review_required';
}

export function buildApprovalReason(input: {
  legacyApprovalType: string;
  reasonCodes?: string[];
  reasonText?: string;
  aiConfidence: number;
  suggestedAction: string;
  candidateMatches?: ApplicationMatch[];
  autoApprovalThreshold?: number;
}): ApprovalReasonDetails {
  const reasonCodes = input.reasonCodes ?? [];
  const approvalType = resolveApprovalType({
    legacyApprovalType: input.legacyApprovalType,
    reasonCodes,
  });
  const reasonCode = resolvePrimaryReasonCode(reasonCodes);
  const reasonMessage =
    input.reasonText?.trim() ||
    reasonCodeMessage(reasonCode) ||
    approvalTypeLabel(approvalType);

  const stopReason =
    reasonCodes.length > 0
      ? reasonCodes.map(reasonCodeMessage).join(' ')
      : reasonMessage;

  return {
    approvalType,
    reasonCode,
    reasonMessage,
    aiConfidence: input.aiConfidence,
    suggestedAction: input.suggestedAction,
    autoApprovalThreshold: input.autoApprovalThreshold ?? PIPELINE_AUTO_CONFIDENCE_THRESHOLD,
    candidateMatches: input.candidateMatches,
    stopReason,
  };
}

export function parseApprovalReasonDetails(
  raw: string | null | undefined,
): ApprovalReasonDetails | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ApprovalReasonDetails;
    if (!parsed.approvalType || !parsed.reasonMessage) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeApprovalReasonDetails(details: ApprovalReasonDetails): string {
  return JSON.stringify(details);
}

export function approvalReasonFromLegacyRow(row: {
  approvalType: string;
  reason: string;
  confidence: number;
  suggestedAction?: string | null;
  detailsJson?: string | null;
}): ApprovalReasonDetails {
  const parsed = parseApprovalReasonDetails(row.detailsJson);
  if (parsed) return parsed;

  const reasonCodes = row.reason
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return buildApprovalReason({
    legacyApprovalType: row.approvalType,
    reasonCodes,
    reasonText: row.reason.includes('_') ? undefined : row.reason,
    aiConfidence: row.confidence,
    suggestedAction: row.suggestedAction ?? 'Review and approve or reject the suggested action.',
  });
}
