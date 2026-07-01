import type { PipelineStatus } from './emailAutomationTypes.js';
import type { EmailClassification } from './emailClassificationTypes.js';
import type { PipelineUpdateProposal } from './emailAutomationTypes.js';
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

function isForwardTransition(from: PipelineStatus, to: PipelineStatus): boolean {
  if (from === to) return true;
  if (to === 'rejected' || to === 'ghosted') return true;
  return statusIndex(to) >= statusIndex(from);
}

export function proposedStatusFromClassification(
  classification: EmailClassification | string | null,
  interviewDetected: boolean,
): PipelineStatus | null {
  switch (classification) {
    case 'Application Confirmation':
      return 'applied';
    case 'Recruiter Outreach':
      return 'recruiter_screen';
    case 'Interview Request':
    case 'Scheduling':
      return interviewDetected ? 'interviewing' : 'recruiter_screen';
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
}): PipelineUpdateProposal | null {
  const proposedStatus = proposedStatusFromClassification(
    input.classification,
    input.interviewDetected,
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
