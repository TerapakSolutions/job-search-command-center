import * as supabaseJobsClient from './supabaseJobsClient';

describe('supabaseJobsClient', () => {
  it('should export functions', () => {
    expect(supabaseJobsClient).toBeDefined();
  });
});

jest.mock('./supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: async () => ({
        data: [{ id: 1, title: 'Test', company: 'TestCo', status: 'queued' }],
        error: null,
      }),
    }),
  },
}));

import { fetchJobs } from './supabaseJobsClient';

describe('fetchJobs', () => {
  it('returns jobs array', async () => {
    const jobs = await fetchJobs();
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs[0]).toHaveProperty('id');
  });
});
