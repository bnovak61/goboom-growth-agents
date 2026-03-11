import { createLogger } from '../../shared/utils/logger.js';
import {
  ClientRecord,
  AgentTask,
  createEscalation,
  logAction,
} from '../../shared/clients/supabase.js';
import {
  TaskType,
  AUTO_EXECUTE_ACTIONS,
  ALWAYS_APPROVE_ACTIONS,
  THRESHOLD_ACTIONS,
} from './types.js';

const logger = createLogger('approval-gate');

export type ApprovalDecision = 'auto_execute' | 'needs_approval';

export interface ApprovalResult {
  decision: ApprovalDecision;
  reason: string;
  escalationId?: string;
}

export async function checkApprovalGate(
  client: ClientRecord,
  task: AgentTask
): Promise<ApprovalResult> {
  const taskType = task.task_type as TaskType;

  // Always-approve actions require approval regardless of client settings
  if (ALWAYS_APPROVE_ACTIONS.has(taskType)) {
    logger.info({ taskType, clientId: client.id }, 'Action always requires approval');
    return await escalateAction(client, task, 'Action type always requires approval');
  }

  // Check client approval mode
  switch (client.approval_mode) {
    case 'auto': {
      // Auto mode: execute everything except always-approve actions (handled above)
      logger.info({ taskType, clientId: client.id }, 'Client in auto mode — executing');
      return { decision: 'auto_execute', reason: 'Client approval_mode is auto' };
    }

    case 'approve_all': {
      // Approve-all mode: everything needs approval except safe read-only ops
      if (AUTO_EXECUTE_ACTIONS.has(taskType) && !THRESHOLD_ACTIONS.has(taskType)) {
        // Safe actions like analysis/monitoring can still auto-execute
        const safeReadActions: Set<TaskType> = new Set([
          'performance_check',
          'creative_fatigue_check',
          'lead_score',
          'generate_report',
          'meta_analyze',
          'google_analyze',
        ]);

        if (safeReadActions.has(taskType)) {
          return { decision: 'auto_execute', reason: 'Read-only action, safe to auto-execute' };
        }
      }

      logger.info({ taskType, clientId: client.id }, 'Client requires approval for all actions');
      return await escalateAction(client, task, 'Client approval_mode is approve_all');
    }

    case 'approve_above_threshold': {
      // Threshold mode: auto-execute small changes, escalate large ones
      if (AUTO_EXECUTE_ACTIONS.has(taskType) && !THRESHOLD_ACTIONS.has(taskType)) {
        return { decision: 'auto_execute', reason: 'Action is in auto-execute set' };
      }

      if (THRESHOLD_ACTIONS.has(taskType)) {
        const changePercent = extractChangePercent(task);
        const threshold = client.budget_change_threshold || 20;

        if (changePercent !== null && changePercent <= threshold) {
          logger.info(
            { taskType, changePercent, threshold, clientId: client.id },
            'Budget change within threshold — auto-executing'
          );
          return {
            decision: 'auto_execute',
            reason: `Change of ${changePercent}% is within ${threshold}% threshold`,
          };
        }

        logger.info(
          { taskType, changePercent, threshold, clientId: client.id },
          'Budget change exceeds threshold — escalating'
        );
        return await escalateAction(
          client,
          task,
          `Change of ${changePercent ?? 'unknown'}% exceeds ${threshold}% threshold`
        );
      }

      // Non-threshold, non-auto actions → escalate
      return await escalateAction(client, task, 'Action requires approval');
    }

    default: {
      // Fallback: escalate unknown modes
      return await escalateAction(client, task, 'Unknown approval mode — escalating for safety');
    }
  }
}

function extractChangePercent(task: AgentTask): number | null {
  const payload = task.proposed_action ?? task.payload;
  if (!payload) return null;

  if (typeof payload.change_percent === 'number') return payload.change_percent;
  if (typeof payload.budget_change_percent === 'number') return payload.budget_change_percent;

  // Calculate from before/after values
  const before = payload.current_value as number | undefined;
  const after = payload.new_value as number | undefined;
  if (before && after && before > 0) {
    return Math.abs(((after - before) / before) * 100);
  }

  return null;
}

async function escalateAction(
  client: ClientRecord,
  task: AgentTask,
  reason: string
): Promise<ApprovalResult> {
  const escalation = await createEscalation({
    client_id: client.id,
    agent_name: task.agent_name,
    task_id: task.id,
    action_type: task.task_type,
    description: task.proposed_action?.description as string ??
      `${task.task_type} for ${client.name}`,
    proposed_action: task.proposed_action ?? task.payload,
    reasoning: reason,
    status: 'pending',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h expiry
  });

  await logAction({
    client_id: client.id,
    agent_name: task.agent_name,
    action_type: 'escalation_created',
    entity_type: 'task',
    entity_id: task.id ?? 'unknown',
    description: `Escalation created: ${reason}`,
    status: 'pending',
  });

  logger.info(
    { escalationId: escalation?.id, clientId: client.id, taskType: task.task_type },
    'Escalation created'
  );

  return {
    decision: 'needs_approval',
    reason,
    escalationId: escalation?.id,
  };
}
