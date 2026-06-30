export type DocumentType = 'resume' | 'cover_letter' | 'other';

export interface Document {
  id: string;
  applicationId: string | null;
  name: string;
  type: DocumentType;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentInput {
  applicationId: string | null;
  name: string;
  type: DocumentType;
  content: string;
}
