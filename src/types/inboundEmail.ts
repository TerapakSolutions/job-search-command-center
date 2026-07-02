export type ProcessingStatus = 'unprocessed' | 'processing' | 'processed' | 'failed';

export interface PendingApprovalSummary {
  id: string;
  approvalType: string;
  label: string;
  reason: string;
  proposedStatus: string;
  currentStatus: string | null;
  company?: string;
  roleTitle?: string;
}

export interface ForwardedEmailSummary {
  isForwarded: boolean;
  forwardedByEmail: string;
  originalSenderEmail: string | null;
  originalSenderName: string | null;
  originalSubject: string | null;
  originalRecipient: string | null;
  originalSentAt: string | null;
  originalCompany: string | null;
}

export interface ProcessingTimelineStep {
  step: string;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  timestamp: string | null;
  message: string;
  error?: string | null;
}

export interface ProcessingTimeline {
  steps: ProcessingTimelineStep[];
}

export interface InboundEmailListItem {
  id: string;
  subject: string;
  fromEmail: string;
  toEmail: string;
  receivedAt: string;
  processed: boolean;
  classification: string | null;
  classificationConfidence: number | null;
  suggestedAction: string | null;
  requiresResponse: boolean | null;
  processedAt: string | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  lastProcessedAt: string | null;
  needsApproval: boolean;
  approvalItems?: PendingApprovalSummary[];
}

export interface InboundEmailDetail extends InboundEmailListItem {
  provider: string;
  textBody: string;
  htmlBody: string | null;
  companyName: string | null;
  positionTitle: string | null;
  recruiterName: string | null;
  actionDueAt: string | null;
  interviewDetected: boolean | null;
  interviewDatetime: string | null;
  aiSummary: string | null;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingAttempts: number;
  forwarded: ForwardedEmailSummary;
  processingTimeline: ProcessingTimeline | null;
  pendingApprovals: PendingApprovalSummary[];
}

export interface InboundEmailClassification {
  classification: string | null;
  classificationConfidence: number | null;
  companyName: string | null;
  positionTitle: string | null;
  recruiterName: string | null;
  requiresResponse: boolean | null;
  suggestedAction: string | null;
  actionDueAt: string | null;
  interviewDetected: boolean | null;
  interviewDatetime: string | null;
  aiSummary: string | null;
  processedAt: string | null;
}

export interface InboundEmailListResponse {
  items: InboundEmailListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface InboundEmailFilters {
  limit?: number;
  offset?: number;
  processed?: boolean;
  sender?: string;
  subject?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ClassifyInboundEmailResponse {
  classification: InboundEmailClassification;
  email: InboundEmailDetail;
}

export interface ClassifyUnprocessedResponse {
  classified: number;
  failed: number;
  skipped: number;
}

export interface InboundEmailProcessingResponse {
  result: {
    emailId: string;
    processingStatus: ProcessingStatus;
    processingError: string | null;
    classificationRan: boolean;
    automationActions: number;
    pendingApprovals: number;
  };
  email: InboundEmailDetail;
}
