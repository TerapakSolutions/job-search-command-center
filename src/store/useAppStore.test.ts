import { act } from 'react';
import { useAppStore } from './useAppStore';

describe('useAppStore', () => {
  it('should initialize with default state', () => {
    const state = useAppStore.getState();
    expect(state).toBeDefined();
    expect(state.status).toBe('active');
    expect(Array.isArray(state.jobs)).toBe(true);
  });

  it('loadJobs updates jobs, queueLength, completed, and status', async () => {
    jest.spyOn(require('../api/supabaseJobsClient'), 'fetchJobs').mockResolvedValue([
      { id: 1, status: 'queued' },
      { id: 2, status: 'completed' },
    ]);
    await act(async () => {
      await useAppStore.getState().loadJobs();
    });
    const state = useAppStore.getState();
    expect(state.jobs.length).toBe(2);
    expect(state.queueLength).toBe(1);
    expect(state.completed).toBe(1);
    expect(state.status).toBe('idle');
  });
});
