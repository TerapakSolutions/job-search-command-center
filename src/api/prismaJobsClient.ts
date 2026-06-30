import type { Job, JobsClient } from '../types/job';

export const prismaJobsClient: JobsClient = {
  async fetchAll(): Promise<Job[]> {
    return [];
  },

  async add(job: Job): Promise<Job> {
    return job;
  },

  async remove(): Promise<void> {
    // stub
  },
};
