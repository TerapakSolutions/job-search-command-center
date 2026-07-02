import type { AutomationActionType } from './emailAutomationTypes.js';

export const AUTOMATION_OUTCOMES = [
  'created_application',
  'updated_application',
  'updated_pipeline',
  'created_contact',
  'created_interview',
  'duplicate_skipped',
  'waiting_for_approval',
  'automation_skipped',
  'processing_failed',
] as const;

export type AutomationOutcome = (typeof AUTOMATION_OUTCOMES)[number];

export function automationOutcomeLabel(outcome: AutomationOutcome): string {
  switch (outcome) {
    case 'created_application':
      return 'Created application';
    case 'updated_application':
      return 'Updated application';
    case 'updated_pipeline':
      return 'Updated pipeline';
    case 'created_contact':
      return 'Created contact';
    case 'created_interview':
      return 'Created interview';
    case 'duplicate_skipped':
      return 'Duplicate skipped';
    case 'waiting_for_approval':
      return 'Waiting for approval';
    case 'automation_skipped':
      return 'Automation skipped';
    case 'processing_failed':
      return 'Processing failed';
    default: {
      const fallback = outcome as string;
      return fallback.replace(/_/g, ' ');
    }
  }
}

export function formatAutomationActionMessage(input: {
  actionType: AutomationActionType | string;
  success: boolean;
  pendingApprovalId?: string;
  detail?: string;
}): string {
  if (input.pendingApprovalId) {
    return input.detail
      ? `${automationOutcomeLabel('waiting_for_approval')}: ${input.detail}`
      : automationOutcomeLabel('waiting_for_approval');
  }

  if (!input.success) {
    if (input.actionType === 'create_application') {
      return input.detail
        ? `${automationOutcomeLabel('duplicate_skipped')}: ${input.detail}`
        : automationOutcomeLabel('duplicate_skipped');
    }
    return input.detail
      ? `${automationOutcomeLabel('automation_skipped')}: ${input.detail}`
      : automationOutcomeLabel('automation_skipped');
  }

  switch (input.actionType) {
    case 'create_application':
      return input.detail
        ? `${automationOutcomeLabel('created_application')}: ${input.detail}`
        : automationOutcomeLabel('created_application');
    case 'update_pipeline':
      return input.detail
        ? `${automationOutcomeLabel('updated_pipeline')}: ${input.detail}`
        : automationOutcomeLabel('updated_pipeline');
    case 'create_contact':
      return input.detail
        ? `${automationOutcomeLabel('created_contact')}: ${input.detail}`
        : automationOutcomeLabel('created_contact');
    case 'create_interview':
      return input.detail
        ? `${automationOutcomeLabel('created_interview')}: ${input.detail}`
        : automationOutcomeLabel('created_interview');
    case 'match_applications':
      return automationOutcomeLabel('waiting_for_approval');
    case 'draft_reply':
      return automationOutcomeLabel('waiting_for_approval');
    default:
      return input.detail ?? automationOutcomeLabel('updated_application');
  }
}
