export type ReminderType =
  | 'follow_up_applied'
  | 'recruiter_no_reply'
  | 'interview_prep'
  | 'stale_review';

export type ReminderPriority = 'high' | 'medium' | 'low';

export interface Reminder {
  id: string;
  type: ReminderType;
  priority: ReminderPriority;
  title: string;
  description: string;
  applicationId: string;
  contactId?: string;
  dueDate: string;
}

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  follow_up_applied: 'Follow up on application',
  recruiter_no_reply: 'Ping recruiter',
  interview_prep: 'Interview prep',
  stale_review: 'Review stale application',
};
