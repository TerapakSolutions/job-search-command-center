const APPLICATION_CONFIRMATION_PHRASES = [
  'thank you for your application',
  'thanks for applying',
  'application received',
  'we received your application',
  'your application has been submitted',
  'confirming your application',
  'thank you for applying to',
  'application confirmation',
  'candidate portal',
  'workday application',
  'greenhouse application',
  'lever application',
  'ashby application',
  'thank you for applying',
];

export function isApplicationConfirmationText(text: string): boolean {
  const normalized = text.toLowerCase();
  return APPLICATION_CONFIRMATION_PHRASES.some((phrase) =>
    normalized.includes(phrase),
  );
}

export function isUnknownRole(roleTitle: string | null | undefined): boolean {
  const trimmed = roleTitle?.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower === 'unknown role' ||
    lower === 'application not identified yet' ||
    lower === 'role from email'
  );
}

export function isLikelyDomainCompany(company: string): boolean {
  const trimmed = company.trim();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed) && !trimmed.includes(' ');
}

export function hasIdentifiedCompanyAndRole(input: {
  companyName: string | null | undefined;
  originalCompany?: string | null | undefined;
  positionTitle: string | null | undefined;
}): boolean {
  const company = input.companyName?.trim() || input.originalCompany?.trim();
  if (!company || isLikelyDomainCompany(company)) return false;
  return !isUnknownRole(input.positionTitle);
}

export function isNoReplyOrApplicationConfirmation(input: {
  fromEmail: string;
  classification: string | null;
  subject: string;
  textBody: string;
}): boolean {
  const from = input.fromEmail.toLowerCase();
  if (
    from.includes('noreply') ||
    from.includes('no-reply') ||
    from.includes('donotreply') ||
    from.includes('notifications@') ||
    from.includes('mailer-daemon')
  ) {
    return true;
  }

  if (input.classification === 'Application Confirmation') {
    return true;
  }

  return isApplicationConfirmationText(`${input.subject}\n${input.textBody}`);
}

export function formatApprovalTypeLabel(approvalType: string): string {
  switch (approvalType) {
    case 'create_application_suggestion':
      return 'Approve creating application';
    case 'link_application':
      return 'Approve linking to existing application';
    case 'pipeline_update':
      return 'Approve pipeline update';
    case 'create_contact':
      return 'Approve recruiter contact creation';
    case 'draft_reply':
      return 'Approve draft reply';
    default:
      return `Approve ${approvalType.replace(/_/g, ' ')}`;
  }
}

export function formatPipelineApprovalLabel(
  proposedStatus: string,
  currentStatus: string | null,
): string {
  const statusLabel = proposedStatus.replace(/_/g, ' ');
  const capitalized = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);
  if (currentStatus && currentStatus !== proposedStatus) {
    return `Approve pipeline update to ${capitalized}`;
  }
  return `Approve pipeline update to ${capitalized}`;
}

export function formatApprovalReason(reason: string): string {
  const parts = reason.split(',').map((part) => part.trim());
  const labels = parts.map((part) => {
    switch (part) {
      case 'low_confidence_classification':
        return 'Queued approval: low confidence';
      case 'ambiguous_application_match':
        return 'Queued approval: ambiguous match';
      case 'offer':
        return 'Offer requires manual review';
      case 'salary_negotiation':
        return 'Salary negotiation requires manual review';
      case 'interview_scheduling':
        return 'Interview scheduling requires manual review';
      case 'protected_pipeline_status':
        return 'Protected pipeline status requires approval';
      case 'requires_response':
        return 'Reply may require sending email';
      default:
        return part.replace(/_/g, ' ');
    }
  });
  return labels.join('; ');
}

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
    return `${input.company} — ${contactRoleFallback(input.roleTitle)}`;
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
