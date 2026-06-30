import { prismaJobsClient } from './prismaJobsClient';

describe('prismaJobsClient', () => {
  it('should export async functions', () => {
    expect(typeof prismaJobsClient.fetchAll).toBe('function');
    expect(typeof prismaJobsClient.add).toBe('function');
    expect(typeof prismaJobsClient.remove).toBe('function');
  });

  it('fetchAll returns an array', async () => {
    const result = await prismaJobsClient.fetchAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it('add returns the job', async () => {
    const job = { id: 1 };
    const result = await prismaJobsClient.add(job);
    expect(result).toBe(job);
  });
});
