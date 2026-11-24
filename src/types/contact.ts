export interface Contact {
  id: string;
  applicationId: string | null;
  name: string;
  email: string;
  linkedIn: string;
  phone?: string | null;
  title?: string | null;
  company: string;
  source: string;
  lastContactDate: string | null;
  messageNotes: string;
  nextAction: string;
  /** A decline you sent this recruiter was logged; Today asks to close the thread. */
  declineDetectedAt?: string | null;
  /** You confirmed closing this recruiter's thread; it no longer nudges. */
  threadClosedAt?: string | null;
  /** You kept the thread open (or they wrote after a close): nudges resume. */
  threadKeptOpenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  applicationId: string | null;
  name: string;
  email: string;
  linkedIn: string;
  phone?: string | null;
  title?: string | null;
  company: string;
  source: string;
  lastContactDate: string | null;
  messageNotes: string;
  nextAction: string;
  declineDetectedAt?: string | null;
  threadClosedAt?: string | null;
  /** You kept the thread open (or they wrote after a close): nudges resume. */
  threadKeptOpenAt?: string | null;
}
