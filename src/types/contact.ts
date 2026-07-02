export interface Contact {
  id: string;
  applicationId: string | null;
  name: string;
  email: string;
  linkedIn: string;
  company: string;
  source: string;
  lastContactDate: string | null;
  messageNotes: string;
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  applicationId: string | null;
  name: string;
  email: string;
  linkedIn: string;
  company: string;
  source: string;
  lastContactDate: string | null;
  messageNotes: string;
  nextAction: string;
}
