export function isMeaningfulContactNextAction(nextAction: string): boolean {
  const trimmed = nextAction.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !(
    lower.includes('no action needed') ||
    lower.includes('no action required') ||
    lower.includes('application received') ||
    lower.includes('wait response') ||
    lower.includes('wait for response') ||
    lower === 'none' ||
    lower === 'n/a'
  );
}

export function contactRoleFallback(roleTitle: string | null | undefined): string {
  const trimmed = roleTitle?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown role') {
    return 'Application not identified yet';
  }
  return trimmed;
}

export function contactApplicationLabel(input: {
  applicationId: string | null;
  company: string;
  roleTitle?: string | null;
  source?: string;
  linkedIn?: string;
}): string {
  if (input.applicationId && input.roleTitle) {
    return `${input.company} — ${contactRoleFallback(input.roleTitle)}`;
  }
  if (input.applicationId) {
    return `${input.company} — No linked application yet`;
  }
  if (input.linkedIn?.trim()) {
    return input.company ? `${input.company} — LinkedIn contact` : 'LinkedIn contact';
  }
  if (input.source === 'linkedin') {
    return input.company ? `${input.company} — LinkedIn contact` : 'LinkedIn contact';
  }
  if (input.company) {
    return `${input.company} — Recruiter contact only`;
  }
  return 'Recruiter contact only';
}

export function contactSourceLabel(source: string | undefined): string {
  switch (source) {
    case 'linkedin':
      return 'LinkedIn';
    case 'email':
      return 'Inbound email';
    case 'manual':
      return 'Manual entry';
    default:
      return source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Unknown';
  }
}

export function formatApprovalLabel(approvalType: string, proposedStatus: string): string {
  switch (approvalType) {
    case 'create_application_suggestion':
      return 'Approve creating application';
    case 'link_application':
      return 'Approve linking to existing application';
    case 'pipeline_update': {
      const statusLabel = proposedStatus.replace(/_/g, ' ');
      const capitalized = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);
      return `Approve pipeline update to ${capitalized}`;
    }
    case 'create_contact':
      return 'Approve recruiter contact creation';
    case 'draft_reply':
      return 'Approve draft reply';
    default:
      return `Approve ${approvalType.replace(/_/g, ' ')}`;
  }
}

export const PROCESSING_TIMELINE_LABELS: Record<string, string> = {
  received: 'Received',
  persisted: 'Persisted',
  classified: 'Classified',
  application_matched: 'Application matched',
  automation_evaluated: 'Automation evaluated',
  safe_actions_applied: 'Safe actions applied',
  approval_queued: 'Approval queued',
  audit_logged: 'Audit logged',
  processing_completed: 'Processing completed',
  processing_failed: 'Processing failed',
};

export function processingTimelineStatusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-700 bg-green-50 border-green-200';
    case 'failed':
      return 'text-red-700 bg-red-50 border-red-200';
    case 'skipped':
      return 'text-gray-600 bg-gray-50 border-gray-200';
    default:
      return 'text-amber-700 bg-amber-50 border-amber-200';
  }
}
