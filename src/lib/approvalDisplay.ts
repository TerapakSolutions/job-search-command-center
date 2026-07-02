import type { PendingApprovalSummary } from '../types/inboundEmail';

export function approvalTypeLabel(type: string): string {
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

export function processingStatusWithApprovalLabel(
  approvals: PendingApprovalSummary[] | undefined,
): string {
  if (!approvals || approvals.length === 0) {
    return 'Awaiting your review';
  }
  const primary = approvals[0];
  return primary.label || approvalTypeLabel(primary.approvalType);
}
