export interface FollowUpTask {
  id: string;
  applicationId: string;
  contactId: string | null;
  title: string;
  description: string;
  dueDate: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpTaskInput {
  applicationId: string;
  contactId: string | null;
  title: string;
  description: string;
  dueDate: string;
  completed: boolean;
  completedAt: string | null;
}
