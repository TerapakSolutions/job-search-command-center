import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env';

const SUPA_URL = getEnv('VITE_SUPABASE_URL');
const SUPA_KEY = getEnv('VITE_SUPABASE_KEY');

export const supabase: SupabaseClient = createClient(SUPA_URL, SUPA_KEY);
