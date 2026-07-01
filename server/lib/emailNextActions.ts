import type { EmailClassification } from './emailClassificationTypes.js';
import type { NextActionSuggestion } from './emailAutomationTypes.js';
import type { ApplicationMatchResult } from './emailAutomationTypes.js';
import type { PipelineUpdateProposal } from './emailAutomationTypes.js';

export function generateNextActions(input: {
  classification: EmailClassification | string | null;
  requiresResponse: boolean | null;
  interviewDetected: boolean | null;
  suggestedAction: string | null;
  matches: ApplicationMatchResult;
  pipelineProposal: PipelineUpdateProposal | null;
  canCreateApplication: boolean;
}): NextActionSuggestion[] {
  const actions: NextActionSuggestion[] = [];
  const classification = input.classification;

  if (input.requiresResponse) {
    actions.push({
      type: 'reply',
      label: 'Reply to recruiter',
      description:
        input.suggestedAction ?? 'Send a timely response to the recruiter.',
      priority: 'high',
    });
  }

  if (
    classification === 'Interview Request' ||
    classification === 'Scheduling' ||
    input.interviewDetected
  ) {
    actions.push({
      type: 'schedule_interview',
      label: 'Schedule interview',
      description: 'Confirm interview time and log it on the application.',
      priority: 'high',
    });
    actions.push({
      type: 'prepare',
      label: 'Prepare for interview',
      description: 'Review the role, company, and your talking points.',
      priority: 'medium',
    });
  }

  if (classification === 'Follow-up Required') {
    actions.push({
      type: 'follow_up',
      label: 'Send follow-up',
      description: 'Reply with a concise status update or question.',
      priority: 'high',
    });
  }

  if (classification === 'Rejection') {
    actions.push({
      type: 'archive',
      label: 'Archive application',
      description: 'Mark the application as rejected and move on.',
      priority: 'medium',
    });
  }

  if (input.canCreateApplication && !input.matches.bestMatch) {
    actions.push({
      type: 'create_application',
      label: 'Create application',
      description: 'Add a new application from this email.',
      priority: 'medium',
    });
  }

  if (input.pipelineProposal) {
    actions.push({
      type: 'update_pipeline',
      label: `Update to ${input.pipelineProposal.proposedStatus.replace('_', ' ')}`,
      description: input.pipelineProposal.reason,
      priority: input.pipelineProposal.requiresApproval ? 'medium' : 'high',
    });
  }

  if (actions.length === 0) {
    actions.push({
      type: 'follow_up',
      label: 'Review manually',
      description: input.suggestedAction ?? 'Review this email and decide next steps.',
      priority: 'low',
    });
  }

  return actions;
}

export function buildDraftReply(input: {
  classification: string | null;
  recruiterName: string | null;
  companyName: string | null;
  positionTitle: string | null;
  subject: string;
}): string {
  const greeting = input.recruiterName
    ? `Hi ${input.recruiterName.split(' ')[0]},`
    : 'Hi,';
  const role = input.positionTitle
    ? ` for the ${input.positionTitle} role`
    : '';
  const company = input.companyName ? ` at ${input.companyName}` : '';

  switch (input.classification) {
    case 'Interview Request':
    case 'Scheduling':
      return `${greeting}

Thank you for reaching out${company}${role}. I'm excited about the opportunity and would love to schedule a conversation. I'm generally available this week — please let me know what times work best for you.

Best regards`;
    case 'Recruiter Outreach':
      return `${greeting}

Thank you for thinking of me${company}${role}. I'd love to learn more about the opportunity. Could you share a few details about the role and next steps?

Best regards`;
    case 'Follow-up Required':
      return `${greeting}

Thanks for following up on my application${company}${role}. I remain very interested and wanted to check in on the status. Please let me know if there's anything else you need from me.

Best regards`;
    case 'Offer':
      return `${greeting}

Thank you for the offer${company}${role}. I'm reviewing the details and will get back to you shortly with any questions.

Best regards`;
    default:
      return `${greeting}

Thank you for your email regarding "${input.subject}"${company}${role}. I wanted to follow up and confirm receipt. Please let me know if you need anything else from me.

Best regards`;
  }
}
