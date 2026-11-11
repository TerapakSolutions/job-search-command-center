import type { PipelineStatus , PipelineUpdateProposal } from './emailAutomationTypes.js';
import type { EmailClassification } from './emailClassificationTypes.js';
import { PIPELINE_AUTO_CONFIDENCE_THRESHOLD } from './emailAutomationTypes.js';

const STATUS_ORDER: PipelineStatus[] = [
  'saved',
  'applied',
  'recruiter_screen',
  'interviewing',
  'final_round',
  'offer',
  'rejected',
  'ghosted',
];

function statusIndex(status: PipelineStatus): number {
  return STATUS_ORDER.indexOf(status);
}

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  recruiter_screen: 'Recruiter Screen',
  interviewing: 'Interviewing',
  final_round: 'Final Round',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted / Archived',
};

export function pipelineStatusLabel(status: string): string {
  return PIPELINE_STATUS_LABELS[status as PipelineStatus] ?? status.replace(/_/g, ' ');
}

export function isForwardTransition(from: PipelineStatus, to: PipelineStatus): boolean {
  if (from === to) return true;
  if (to === 'rejected' || to === 'ghosted') return true;
  return statusIndex(to) >= statusIndex(from);
}

// A meeting with the hiring team (not a recruiter screen).
const HIRING_TEAM =
  /hiring manager|\bpanel\b|technical (?:interview|round|assessment)|\bon-?site\b|final round|meet (?:with )?the team/;
// Words that name a recruiter screen outright. They win over hiring-team
// words. A bare "screen" is not one ("share your screen").
const SCREENING =
  /\bscreening\b|\b(?:phone|recruiter|initial|intro) screen\b|initial (?:zoom |phone |video )?(?:call|chat|conversation)|intro(?:ductory)? call/;
// A short call is a screen unless the email names the hiring team.
const SHORT_CALL = /\b(?:15|20|30)[- ]min(?:ute)?s?\b/;

function interviewStageFromText(emailText: string | undefined): PipelineStatus | null {
  if (!emailText) return null;
  const text = emailText.toLowerCase();
  if (SCREENING.test(text)) return 'recruiter_screen';
  if (HIRING_TEAM.test(text)) return 'interviewing';
  if (SHORT_CALL.test(text)) return 'recruiter_screen';
  return null;
}

export function proposedStatusFromClassification(
  classification: EmailClassification | string | null,
  interviewDetected: boolean,
  emailText?: string,
): PipelineStatus | null {
  switch (classification) {
    case 'Application Confirmation':
      return 'applied';
    case 'Recruiter Outreach':
      return 'recruiter_screen';
    case 'Interview Request':
    case 'Scheduling':
      return (
        interviewStageFromText(emailText) ??
        (interviewDetected ? 'interviewing' : 'recruiter_screen')
      );
    case 'Offer':
      return 'offer';
    case 'Rejection':
      return 'rejected';
    case 'Follow-up Required':
      return 'recruiter_screen';
    default:
      return null;
  }
}

export function buildPipelineUpdateProposal(input: {
  applicationId: string;
  currentStatus: PipelineStatus;
  classification: string | null;
  classificationConfidence: number | null;
  interviewDetected: boolean;
  /** Subject and body, used to tell a recruiter screen from an interview. */
  emailText?: string;
}): PipelineUpdateProposal | null {
  const proposedStatus = proposedStatusFromClassification(
    input.classification,
    input.interviewDetected,
    input.emailText,
  );
  if (!proposedStatus) return null;
  if (input.currentStatus === proposedStatus) return null;
  if (!isForwardTransition(input.currentStatus, proposedStatus)) return null;

  const confidence = input.classificationConfidence ?? 50;
  const requiresApproval = confidence < PIPELINE_AUTO_CONFIDENCE_THRESHOLD;

  return {
    applicationId: input.applicationId,
    currentStatus: input.currentStatus,
    proposedStatus,
    confidence,
    requiresApproval,
    reason: `Email classified as "${input.classification}" suggests status "${proposedStatus}"`,
  };
}
