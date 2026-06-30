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

export const WORK_LOCATION_TYPES = ['remote', 'hybrid', 'onsite'] as const;

export type WorkLocationType = (typeof WORK_LOCATION_TYPES)[number];

export interface Application {
  id: string;
  company: string;
  roleTitle: string;
  jobUrl: string;
  workLocationType: WorkLocationType;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  dateApplied: string | null;
  status: PipelineStatus;
  notes: string;
  interviewDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationInput {
  company: string;
  roleTitle: string;
  jobUrl: string;
  workLocationType: WorkLocationType;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  dateApplied: string | null;
  status: PipelineStatus;
  notes: string;
  interviewDate: string | null;
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

export const WORK_LOCATION_LABELS: Record<WorkLocationType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};
