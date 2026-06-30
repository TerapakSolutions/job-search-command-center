import { create } from 'zustand';
import { fetchJobs } from '../api/supabaseJobsClient';
import type { Job } from '../types/job';

export type AppStatus = 'active' | 'paused' | 'loading' | 'idle' | 'error';

interface AppState {
  status: AppStatus;
  jobs: Job[];
  queue: Job[];
  queueLength: number;
  completed: number;
  setStatus: (status: AppStatus) => void;
  loadJobs: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'active',
  jobs: [],
  queue: [],
  queueLength: 0,
  completed: 0,

  setStatus: (status) => set({ status }),

  loadJobs: async () => {
    set({ status: 'loading' });
    try {
      const jobs = await fetchJobs();
      const queue = jobs.filter((j) => j.status === 'queued');
      set({
        jobs,
        queue,
        queueLength: queue.length,
        completed: jobs.filter((j) => j.status === 'completed').length,
        status: 'idle',
      });
    } catch {
      set({ status: 'error' });
    }
  },
}));
