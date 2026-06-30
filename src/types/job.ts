export type JobStatus = 'queued' | 'completed' | string;

export interface Job {
  id: number | string;
  title?: string;
  company?: string;
  status?: JobStatus;
  createdAt?: string;
}

export interface JobsClient {
  fetchAll(): Promise<Job[]>;
  add(job: Job): Promise<Job>;
  remove(id: Job['id']): Promise<void>;
}
