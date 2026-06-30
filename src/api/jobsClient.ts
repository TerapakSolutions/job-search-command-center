import { supabaseJobsClient } from './supabaseJobsClient';
import { prismaJobsClient } from './prismaJobsClient';
import type { JobsClient } from '../types/job';
import { getEnv } from '../lib/env';

const ADAPTER = getEnv('VITE_DB_ADAPTER', 'supabase');

export const jobsClient: JobsClient =
  ADAPTER === 'prisma' ? prismaJobsClient : supabaseJobsClient;
