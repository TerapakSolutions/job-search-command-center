export const PIPELINE_STATUSES = [
  'saved',
  'applied',
  'recruiter_screen',
  'interviewing',
  'final_round',
  'offer',
  'rejected',
  'ghosted',
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const AUTOMATION_ACTION_TYPES = [
  'match_applications',
  'create_application',
  'create_contact',
  'update_pipeline',
  'draft_reply',
  'record_communication',
  'run_automation',
  'auto_process',
  'reanalyze',
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const NEXT_ACTION_TYPES = [
  'reply',
  'schedule_interview',
  'follow_up',
  'prepare',
  'archive',
  'create_application',
  'update_pipeline',
] as const;

export type NextActionType = (typeof NEXT_ACTION_TYPES)[number];

export interface ApplicationMatch {
  applicationId: string;
  company: string;
  roleTitle: string;
  status: string;
  confidence: number;
  matchReasons: string[];
}

export interface ApplicationMatchResult {
  matches: ApplicationMatch[];
  bestMatch: ApplicationMatch | null;
  requiresManualSelection: boolean;
}

export interface NextActionSuggestion {
  type: NextActionType;
  label: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PipelineUpdateProposal {
  applicationId: string;
  currentStatus: PipelineStatus;
  proposedStatus: PipelineStatus;
  confidence: number;
  requiresApproval: boolean;
  reason: string;
}

export interface EmailAutomationAnalysis {
  emailId: string;
  matches: ApplicationMatchResult;
  nextActions: NextActionSuggestion[];
  pipelineProposal: PipelineUpdateProposal | null;
  canCreateApplication: boolean;
  duplicateApplicationId: string | null;
}

export interface AutomationActionResult {
  success: boolean;
  actionType: AutomationActionType;
  confidence: number | null;
  auditLogId: string;
  pendingApprovalId?: string;
  changes: Record<string, unknown>;
  message: string;
}

export interface AuditLogEntry {
  id: string;
  inboundEmailId: string;
  actionType: AutomationActionType;
  confidence: number | null;
  status: string;
  details: Record<string, unknown>;
  resultingChanges: Record<string, unknown>;
  createdAt: string;
  emailSubject?: string;
}

export interface PendingApprovalEntry {
  id: string;
  inboundEmailId: string;
  approvalType: string;
  applicationId: string | null;
  proposedStatus: string;
  currentStatus: string | null;
  confidence: number;
  reason: string;
  reasonCode: string;
  reasonMessage: string;
  suggestedAction: string;
  autoApprovalThreshold: number;
  stopReason: string;
  candidateMatches: ApplicationMatch[];
  status: string;
  createdAt: string;
  emailSubject?: string;
  company?: string;
  roleTitle?: string;
}

export interface AutomationDashboardSummary {
  recentActions: AuditLogEntry[];
  pendingApprovals: PendingApprovalEntry[];
  attentionApplications: Array<{
    applicationId: string;
    company: string;
    roleTitle: string;
    status: string;
    reason: string;
  }>;
}

/** Minimum confidence to auto-apply pipeline updates without approval. */
export const PIPELINE_AUTO_CONFIDENCE_THRESHOLD = 75;

/** Minimum match confidence to treat as a confident single match. */
export const MATCH_CONFIDENCE_THRESHOLD = 70;

/** Gap between top two matches that triggers manual selection. */
export const MATCH_AMBIGUITY_GAP = 15;
