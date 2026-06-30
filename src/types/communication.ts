export type CommunicationChannel = 'email' | 'linkedin' | 'phone' | 'other';
export type CommunicationDirection = 'outbound' | 'inbound';

export interface Communication {
  id: string;
  applicationId: string;
  contactId: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject: string;
  body: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationInput {
  applicationId: string;
  contactId: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject: string;
  body: string;
  occurredAt: string;
}
