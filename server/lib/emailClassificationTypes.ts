export const EMAIL_CLASSIFICATIONS = [
  'Interview Request',
  'Application Confirmation',
  'Rejection',
  'Recruiter Outreach',
  'Follow-up Required',
  'Offer',
  'Scheduling',
  'General Update',
  'Other',
] as const;

export type EmailClassification = (typeof EMAIL_CLASSIFICATIONS)[number];

export interface EmailClassificationResult {
  classification: EmailClassification;
  classificationConfidence: number;
  companyName: string | null;
  positionTitle: string | null;
  recruiterName: string | null;
  requiresResponse: boolean;
  suggestedAction: string;
  actionDueAt: string | null;
  interviewDetected: boolean;
  interviewDatetime: string | null;
  aiSummary: string;
}

export interface InboundEmailClassificationFields {
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
