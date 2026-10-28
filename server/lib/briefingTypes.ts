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

export interface BriefingGoalProgress {
  applicationsToday: number;
  applicationsThisWeek: number;
  applicationsThisMonth: number;
  currentStreak: number;
  longestStreak: number;
  dailyGoal: number;
  weeklyGoal: number;
  monthlyGoal: number;
  dailyMet: boolean;
  weeklyMet: boolean;
  monthlyMet: boolean;
  goalMessages: string[];
  goalsSetByUser?: boolean;
  /** Set when the week/month targets are scaled because goals were set partway through. */
  targetsNote?: string;
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
  goalProgress?: BriefingGoalProgress;
  // Who wrote aiSummary: the LLM, or the rule-based fallback (no key, or the
  // call failed). Absent on briefs written before this was recorded.
  summarySource?: 'llm' | 'rules' | 'paused';
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
      goalProgress: undefined,
    };
  }
}

/** The server's local (Pacific) calendar day, so a brief's date matches the user's day. */
export function toBriefingDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
