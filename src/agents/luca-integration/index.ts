import { createLogger } from '../../shared/utils/logger.js';
import {
  getSupabase,
  getClient,
  upsertTask,
  logAction,
  ClientRecord,
} from '../../shared/clients/supabase.js';
import { TaskType } from '../orchestrator/types.js';

const logger = createLogger('luca-integration');

// Luca webhook payload structure
export interface LucaWebhookPayload {
  client_id: string;
  entity_type: 'campaign' | 'adset' | 'ad';
  entity_id: string;
  entity_name: string;
  action: 'pause' | 'enable' | 'update_budget' | 'manual_review' | 'update_targeting' | 'create_campaign';
  platform: 'meta' | 'google';
  current_value?: string | number;
  new_value?: string | number;
  reasoning?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

// Map Luca actions to our task types
const LUCA_ACTION_TO_TASK: Record<string, { meta: TaskType; google: TaskType }> = {
  pause: { meta: 'luca_pause', google: 'google_pause_campaign' },
  enable: { meta: 'luca_enable', google: 'google_adjust_budget' },
  update_budget: { meta: 'luca_update_budget', google: 'google_adjust_budget' },
  manual_review: { meta: 'luca_manual_review', google: 'luca_manual_review' },
  update_targeting: { meta: 'luca_update_targeting', google: 'google_adjust_bid' },
  create_campaign: { meta: 'luca_create_campaign', google: 'luca_create_campaign' },
};

export async function processLucaWebhook(
  payload: LucaWebhookPayload
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  logger.info({ payload }, 'Processing Luca webhook');

  // Validate payload
  if (!payload.client_id || !payload.action || !payload.entity_id) {
    return { success: false, error: 'Missing required fields: client_id, action, entity_id' };
  }

  // Resolve client — use mapping table fallback for Luca's routing bug
  let client = await getClient(payload.client_id);

  if (!client) {
    client = await resolveClientFromMapping(payload.client_id);
  }

  if (!client) {
    logger.error({ lucaClientId: payload.client_id }, 'Could not resolve client');
    return { success: false, error: `Client not found: ${payload.client_id}` };
  }

  // Map Luca action to task type
  const actionMapping = LUCA_ACTION_TO_TASK[payload.action];
  if (!actionMapping) {
    return { success: false, error: `Unknown Luca action: ${payload.action}` };
  }

  const taskType = actionMapping[payload.platform] ?? actionMapping.meta;

  // Calculate budget change percent if applicable
  let changePercent: number | undefined;
  if (
    payload.action === 'update_budget' &&
    typeof payload.current_value === 'number' &&
    typeof payload.new_value === 'number' &&
    payload.current_value > 0
  ) {
    changePercent = Math.abs(
      ((payload.new_value - payload.current_value) / payload.current_value) * 100
    );
  }

  // Create task for orchestrator
  const task = await upsertTask({
    client_id: client.id,
    agent_name: 'luca-integration',
    task_type: taskType,
    status: 'pending',
    priority: payload.priority ?? 'medium',
    payload: {
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      entity_name: payload.entity_name,
      platform: payload.platform,
      source: 'luca',
    },
    proposed_action: {
      action_type: taskType,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      entity_name: payload.entity_name ?? 'Unknown',
      description: `Luca recommendation: ${payload.action} ${payload.entity_name ?? payload.entity_id}`,
      reasoning: payload.reasoning ?? 'Luca Analytics recommendation',
      current_value: payload.current_value,
      new_value: payload.new_value,
      change_percent: changePercent,
      auto_execute: isAutoExecutable(payload),
      expected_impact: 'Per Luca Analytics recommendation',
      metadata: payload.metadata,
    },
  });

  if (!task) {
    return { success: false, error: 'Failed to create task' };
  }

  await logAction({
    client_id: client.id,
    agent_name: 'luca-integration',
    action_type: 'luca_webhook_received',
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    description: `Luca webhook: ${payload.action} ${payload.entity_name ?? payload.entity_id}`,
    status: 'success',
    metadata: { luca_payload: payload, task_id: task.id },
  });

  logger.info(
    { taskId: task.id, clientName: client.name, action: payload.action },
    'Luca webhook processed — task created'
  );

  return { success: true, taskId: task.id };
}

function isAutoExecutable(payload: LucaWebhookPayload): boolean {
  // Pause/enable are generally safe to auto-execute
  if (payload.action === 'pause') return true;
  if (payload.action === 'enable') return true;

  // Budget updates under 20% are auto-executable
  if (
    payload.action === 'update_budget' &&
    typeof payload.current_value === 'number' &&
    typeof payload.new_value === 'number' &&
    payload.current_value > 0
  ) {
    const changePercent = Math.abs(
      ((payload.new_value - payload.current_value) / payload.current_value) * 100
    );
    return changePercent <= 20;
  }

  // Everything else needs approval
  return false;
}

async function resolveClientFromMapping(
  lucaClientId: string
): Promise<ClientRecord | null> {
  try {
    const { data, error } = await getSupabase()
      .from('luca_client_mapping')
      .select('supabase_client_id')
      .eq('luca_client_id', lucaClientId)
      .single();

    if (error || !data) {
      logger.warn({ lucaClientId }, 'No mapping found in luca_client_mapping');
      return null;
    }

    return getClient(data.supabase_client_id);
  } catch {
    return null;
  }
}

// Express route handler
export function createLucaWebhookHandler() {
  return async (req: any, res: any) => {
    try {
      // Support both single action and batch actions
      const payloads: LucaWebhookPayload[] = Array.isArray(req.body)
        ? req.body
        : [req.body];

      const results = [];
      for (const payload of payloads) {
        const result = await processLucaWebhook(payload);
        results.push(result);
      }

      const allSuccess = results.every((r) => r.success);
      res.status(allSuccess ? 200 : 207).json({
        success: allSuccess,
        results,
      });
    } catch (error) {
      logger.error({ error }, 'Luca webhook handler error');
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
      });
    }
  };
}
