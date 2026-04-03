/**
 * client.ts — Supabase client factory.
 *
 * The agent uses the service_role key which bypasses RLS.
 * The dashboard uses the anon key with RLS-restricted queries.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../types';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(config: AgentConfig): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _client;
}

export { SupabaseClient };
