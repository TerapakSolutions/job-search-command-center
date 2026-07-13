import type { Application, ApplicationInput } from '../types/application';
import type { Contact, ContactInput } from '../types/contact';
import type { Communication, CommunicationInput } from '../types/communication';
import type { FollowUpTask, FollowUpTaskInput } from '../types/followUpTask';
import type { Interview, InterviewInput } from '../types/interview';
import type { Document, DocumentInput } from '../types/document';
import { getApiBaseUrl } from './persistence';
import { apiRequest as request } from './http';

function crud<T, TInput>(resource: string) {
  return {
    list: () => request<T[]>(`/${resource}`),
    get: (id: string) => request<T>(`/${resource}/${id}`),
    create: (input: TInput) =>
      request<T>(`/${resource}`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: Partial<TInput>) =>
      request<T>(`/${resource}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      request<void>(`/${resource}/${id}`, { method: 'DELETE' }),
  };
}

export const applicationsApi = crud<Application, ApplicationInput>('applications');
export const contactsApi = crud<Contact, ContactInput>('contacts');
export const communicationsApi = crud<Communication, CommunicationInput>(
  'communications',
);
export const followUpTasksApi = crud<FollowUpTask, FollowUpTaskInput>(
  'follow-up-tasks',
);
export const interviewsApi = crud<Interview, InterviewInput>('interviews');
export const documentsApi = crud<Document, DocumentInput>('documents');

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/health`, { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadAllData() {
  const [applications, contacts, interviews] = await Promise.all([
    applicationsApi.list(),
    contactsApi.list(),
    interviewsApi.list(),
  ]);
  return { applications, contacts, interviews };
}

export async function clearAllRemote() {
  const [applications, contacts] = await Promise.all([
    applicationsApi.list(),
    contactsApi.list(),
  ]);
  await Promise.all([
    ...contacts.map((c) => contactsApi.remove(c.id)),
    ...applications.map((a) => applicationsApi.remove(a.id)),
  ]);
}
