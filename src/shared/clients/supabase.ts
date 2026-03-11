import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('supabase');

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  supabaseInstance = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  logger.info('Supabase client initialized');
  return supabaseInstance;
}

// --- Client helpers ---

export interface ClientRecord {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'onboarding';
  approval_mode: 'auto' | 'approve_all' | 'approve_above_threshold';
  budget_change_threshold: number;
  notify_on_auto: boolean;
  escalation_channels: string[];
  meta_access_token?: string;
  meta_ad_account_id?: string;
  google_ads_customer_id?: string;
  google_ads_refresh_token?: string;
  practice_area?: string;
  target_cpl?: number;
  monthly_budget?: number;
  created_at: string;
  updated_at: string;
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  const { data, error } = await getSupabase()
    .from('clients')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    logger.error({ error, id }, 'Failed to get client');
    return null;
  }
  return data;
}

export async function getActiveClients(platform?: 'meta' | 'google'): Promise<ClientRecord[]> {
  let query = getSupabase()
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (platform === 'meta') {
    query = query.not('meta_access_token', 'is', null);
  } else if (platform === 'google') {
    query = query.not('google_ads_customer_id', 'is', null);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ error }, 'Failed to get active clients');
    return [];
  }
  return data ?? [];
}

// --- Task helpers ---

export type TaskStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AgentTask {
  id?: string;
  client_id: string;
  agent_name: string;
  task_type: string;
  status: TaskStatus;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  proposed_action?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  created_at?: string;
  updated_at?: string;
  claimed_at?: string;
  completed_at?: string;
}

export async function upsertTask(task: AgentTask): Promise<AgentTask | null> {
  const { data, error } = await getSupabase()
    .from('agent_tasks')
    .upsert(task, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    logger.error({ error, task }, 'Failed to upsert task');
    return null;
  }
  return data;
}

export async function claimTask(taskId: string, agentName: string): Promise<AgentTask | null> {
  const { data, error } = await getSupabase()
    .from('agent_tasks')
    .update({
      status: 'claimed',
      agent_name: agentName,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) {
    logger.warn({ error, taskId }, 'Failed to claim task (may already be claimed)');
    return null;
  }
  return data;
}

export async function completeTask(
  taskId: string,
  result: Record<string, unknown>
): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_tasks')
    .update({
      status: 'completed',
      result,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    logger.error({ error, taskId }, 'Failed to complete task');
  }
}

export async function failTask(taskId: string, errorMsg: string): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_tasks')
    .update({
      status: 'failed',
      error: errorMsg,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    logger.error({ error, taskId }, 'Failed to mark task as failed');
  }
}

export async function getPendingTasks(agentName?: string): Promise<AgentTask[]> {
  let query = getSupabase()
    .from('agent_tasks')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (agentName) {
    query = query.eq('agent_name', agentName);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ error }, 'Failed to get pending tasks');
    return [];
  }
  return data ?? [];
}

// --- Action Log helpers ---

export interface ActionLogEntry {
  id?: string;
  client_id: string;
  agent_name: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  description: string;
  before_value?: Record<string, unknown>;
  after_value?: Record<string, unknown>;
  status: 'success' | 'failed' | 'pending' | 'skipped';
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export async function logAction(entry: ActionLogEntry): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_action_log')
    .insert(entry);

  if (error) {
    logger.error({ error, entry }, 'Failed to log action');
  }
}

// --- Escalation helpers ---

export type EscalationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Escalation {
  id?: string;
  client_id: string;
  agent_name: string;
  task_id?: string;
  action_type: string;
  description: string;
  proposed_action: Record<string, unknown>;
  reasoning?: string;
  status: EscalationStatus;
  responded_by?: string;
  response_notes?: string;
  responded_at?: string;
  expires_at?: string;
  created_at?: string;
}

export async function createEscalation(escalation: Escalation): Promise<Escalation | null> {
  const { data, error } = await getSupabase()
    .from('agent_escalations')
    .insert(escalation)
    .select()
    .single();

  if (error) {
    logger.error({ error, escalation }, 'Failed to create escalation');
    return null;
  }
  return data;
}

export async function getPendingEscalations(): Promise<Escalation[]> {
  const { data, error } = await getSupabase()
    .from('agent_escalations')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error }, 'Failed to get pending escalations');
    return [];
  }
  return data ?? [];
}

export async function respondToEscalation(
  escalationId: string,
  status: 'approved' | 'rejected',
  respondedBy: string,
  notes?: string
): Promise<Escalation | null> {
  const { data, error } = await getSupabase()
    .from('agent_escalations')
    .update({
      status,
      responded_by: respondedBy,
      response_notes: notes,
      responded_at: new Date().toISOString(),
    })
    .eq('id', escalationId)
    .select()
    .single();

  if (error) {
    logger.error({ error, escalationId }, 'Failed to respond to escalation');
    return null;
  }
  return data;
}

// --- Agent State helpers ---

export interface AgentState {
  agent_name: string;
  status: 'running' | 'idle' | 'error' | 'stopped';
  last_heartbeat: string;
  current_task?: string;
  metadata?: Record<string, unknown>;
}

export async function updateAgentHeartbeat(
  agentName: string,
  status: AgentState['status'],
  currentTask?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_state')
    .upsert({
      agent_name: agentName,
      status,
      last_heartbeat: new Date().toISOString(),
      current_task: currentTask,
      metadata,
    }, { onConflict: 'agent_name' });

  if (error) {
    logger.error({ error, agentName }, 'Failed to update heartbeat');
  }
}

export async function getAgentStates(): Promise<AgentState[]> {
  const { data, error } = await getSupabase()
    .from('agent_state')
    .select('*')
    .order('agent_name');

  if (error) {
    logger.error({ error }, 'Failed to get agent states');
    return [];
  }
  return data ?? [];
}

// --- Inter-agent messaging ---

export interface AgentMessage {
  id?: string;
  from_agent: string;
  to_agent: string;
  message_type: string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at?: string;
}

export async function sendAgentMessage(message: Omit<AgentMessage, 'read'>): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_messages')
    .insert({ ...message, read: false });

  if (error) {
    logger.error({ error, message }, 'Failed to send agent message');
  }
}

export async function getUnreadMessages(agentName: string): Promise<AgentMessage[]> {
  const { data, error } = await getSupabase()
    .from('agent_messages')
    .select('*')
    .eq('to_agent', agentName)
    .eq('read', false)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error, agentName }, 'Failed to get unread messages');
    return [];
  }
  return data ?? [];
}

export async function markMessagesRead(messageIds: string[]): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_messages')
    .update({ read: true })
    .in('id', messageIds);

  if (error) {
    logger.error({ error }, 'Failed to mark messages as read');
  }
}
