export const PROCESSING_STATUSES = [
  'unprocessed',
  'processing',
  'processed',
  'failed',
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface InboundEmailProcessingFields {
  processingStatus: ProcessingStatus;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingError: string | null;
  lastProcessedAt: string | null;
  processingAttempts: number;
}

export interface InboundEmailProcessingResult {
  emailId: string;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  classificationRan: boolean;
  automationActions: number;
  pendingApprovals: number;
  skipped?: boolean;
  reason?: string;
}
