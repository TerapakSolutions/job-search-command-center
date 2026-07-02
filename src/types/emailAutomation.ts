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
  type: string;
  label: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PipelineUpdateProposal {
  applicationId: string;
  currentStatus: string;
  proposedStatus: string;
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
  actionType: string;
  confidence: number | null;
  auditLogId: string;
  pendingApprovalId?: string;
  changes: Record<string, unknown>;
  message: string;
}

export interface RunAutomationResponse {
  analysis: EmailAutomationAnalysis;
  results: AutomationActionResult[];
}

export interface DraftReplyResponse {
  draft: string;
  auditLogId: string;
}

export interface AuditLogEntry {
  id: string;
  inboundEmailId: string;
  actionType: string;
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
