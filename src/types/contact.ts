export interface Contact {
  id: string;
  applicationId: string;
  name: string;
  email: string;
  linkedIn: string;
  lastContactDate: string | null;
  messageNotes: string;
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  applicationId: string;
  name: string;
  email: string;
  linkedIn: string;
  lastContactDate: string | null;
  messageNotes: string;
  nextAction: string;
}
