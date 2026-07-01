export interface BriefingApplicationRef {
  id: string;
  company: string;
  roleTitle: string;
  status: string;
  dateApplied: string | null;
  interviewDate: string | null;
}

export interface BriefingEmailRef {
  id: string;
  subject: string;
  fromEmail: string;
  receivedAt: string;
  source: 'communication' | 'inbound_email';
}

export interface BriefingInterviewRef {
  id: string;
  applicationId: string;
  company: string;
  roleTitle: string;
  scheduledAt: string;
  type: string;
}

export interface BriefingFollowUpRef {
  applicationId: string;
  company: string;
  roleTitle: string;
  reason: string;
}

export interface BriefingPipelineStats {
  total: number;
  byStatus: Record<string, number>;
  active: number;
  offers: number;
  rejected: number;
  ghosted: number;
}

export interface BriefingData {
  windowStart: string;
  windowEnd: string;
  briefingDate: string;
  pipelineStats: BriefingPipelineStats;
  newRecruiterEmails: BriefingEmailRef[];
  applicationsSubmitted: BriefingApplicationRef[];
  interviewInvitations: BriefingApplicationRef[];
  upcomingInterviews: BriefingInterviewRef[];
  followUpNeeded: BriefingFollowUpRef[];
  inactiveApplications: BriefingApplicationRef[];
  recruiterResponsesOvernight: BriefingEmailRef[];
  newOpportunities: BriefingApplicationRef[];
  recommendations: string[];
  changesSincePrevious: string[];
}

export interface DailyBriefingRecord {
  id: string;
  userId: string;
  briefingDate: string;
  aiSummary: string;
  data: BriefingData;
  status: 'completed' | 'failed';
  emailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseBriefingData(json: string): BriefingData {
  try {
    return JSON.parse(json) as BriefingData;
  } catch {
    return {
      windowStart: '',
      windowEnd: '',
      briefingDate: '',
      pipelineStats: {
        total: 0,
        byStatus: {},
        active: 0,
        offers: 0,
        rejected: 0,
        ghosted: 0,
      },
      newRecruiterEmails: [],
      applicationsSubmitted: [],
      interviewInvitations: [],
      upcomingInterviews: [],
      followUpNeeded: [],
      inactiveApplications: [],
      recruiterResponsesOvernight: [],
      newOpportunities: [],
      recommendations: [],
      changesSincePrevious: [],
    };
  }
}

export function toBriefingDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}
