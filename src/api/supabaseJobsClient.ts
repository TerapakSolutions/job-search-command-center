import { supabase } from './supabaseClient';
import type { Job, JobsClient } from '../types/job';

export const supabaseJobsClient: JobsClient = {
  async fetchAll(): Promise<Job[]> {
    const { data, error } = await supabase.from('jobs').select('*');
    console.log('[fetchJobs] Data:', data);
    if (error) console.error('[fetchJobs] Error:', error);
    return data ?? [];
  },

  async add(job: Job): Promise<Job> {
    const { data, error } = await supabase.from('jobs').insert(job).select().single();
    if (error) throw error;
    return data as Job;
  },

  async remove(id: Job['id']): Promise<void> {
    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) throw error;
  },
};

export async function fetchJobs(): Promise<Job[]> {
  return supabaseJobsClient.fetchAll();
}
