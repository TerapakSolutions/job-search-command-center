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

export const PAY_PERIODS = ['year', 'hour'] as const;

export type PayPeriod = (typeof PAY_PERIODS)[number];

export const PAY_PERIOD_LABELS: Record<PayPeriod, string> = {
  year: 'Per year',
  hour: 'Per hour',
};

export const EMPLOYMENT_TYPES = ['full_time', 'w2_contract', 'c2c', '1099'] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  w2_contract: 'W2 contract',
  c2c: 'Corp-to-corp (C2C)',
  '1099': '1099 contract',
};

export interface Application {
  id: string;
  company: string;
  roleTitle: string;
  jobUrl: string;
  workLocationType: WorkLocationType;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  // NULL reads as a yearly salary. Optional here so older saved data and
  // fixtures still type-check; ApplicationInput keeps them required.
  payPeriod?: PayPeriod | null;
  employmentType?: EmploymentType | null;
  // Staffing agency that submitted you; company stays the client.
  agency?: string | null;
  submittedDate?: string | null;
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
  // NULL reads as a yearly salary.
  payPeriod: PayPeriod | null;
  employmentType: EmploymentType | null;
  // Staffing agency that submitted you; company stays the client.
  agency: string | null;
  submittedDate: string | null;
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
