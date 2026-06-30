export type InterviewType = 'phone' | 'video' | 'onsite' | 'other';

export interface Interview {
  id: string;
  applicationId: string;
  scheduledAt: string;
  type: InterviewType;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewInput {
  applicationId: string;
  scheduledAt: string;
  type: InterviewType;
  location: string;
  notes: string;
}
