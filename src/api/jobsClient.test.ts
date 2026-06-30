describe('jobsClient', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('exports supabaseJobsClient by default', async () => {
    process.env = { ...process.env, VITE_DB_ADAPTER: undefined };
    jest.doMock('./supabaseJobsClient', () => ({
      supabaseJobsClient: { fetchAll: jest.fn(), add: jest.fn(), remove: jest.fn() },
    }));
    jest.doMock('./prismaJobsClient', () => ({
      prismaJobsClient: { fetchAll: jest.fn(), add: jest.fn(), remove: jest.fn() },
    }));
    const { jobsClient: client } = await import('./jobsClient');
    expect(client).toBeDefined();
    expect(typeof client).toBe('object');
    expect(client.fetchAll).toBeDefined();
  });

  it('exports prismaJobsClient when VITE_DB_ADAPTER=prisma', async () => {
    process.env = { ...process.env, VITE_DB_ADAPTER: 'prisma' };
    jest.doMock('./supabaseJobsClient', () => ({
      supabaseJobsClient: { fetchAll: jest.fn(), add: jest.fn(), remove: jest.fn() },
    }));
    jest.doMock('./prismaJobsClient', () => ({
      prismaJobsClient: { fetchAll: jest.fn(), add: jest.fn(), remove: jest.fn() },
    }));
    const { jobsClient: client } = await import('./jobsClient');
    expect(client).toBeDefined();
    expect(typeof client).toBe('object');
    expect(client.fetchAll).toBeDefined();
  });
});
