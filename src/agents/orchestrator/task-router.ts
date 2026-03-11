import { createLogger } from '../../shared/utils/logger.js';
import {
  AgentTask,
  getClient,
  upsertTask,
  completeTask,
  logAction,
  sendAgentMessage,
} from '../../shared/clients/supabase.js';
import { TaskType, TASK_TO_AGENT, AgentName } from './types.js';
import { checkApprovalGate } from './approval-gate.js';

const logger = createLogger('task-router');

export async function routeTask(task: AgentTask): Promise<void> {
  const taskType = task.task_type as TaskType;
  const targetAgent = TASK_TO_AGENT[taskType];

  if (!targetAgent) {
    logger.warn({ taskType }, 'Unknown task type — cannot route');
    await upsertTask({ ...task, status: 'failed', error: `Unknown task type: ${taskType}` });
    return;
  }

  // Get client for approval gate check
  const client = await getClient(task.client_id);
  if (!client) {
    logger.error({ clientId: task.client_id }, 'Client not found');
    await upsertTask({ ...task, status: 'failed', error: 'Client not found' });
    return;
  }

  // Check approval gate
  const approval = await checkApprovalGate(client, task);

  if (approval.decision === 'needs_approval') {
    // Task is waiting for approval — update status and wait
    await upsertTask({
      ...task,
      status: 'pending',
      result: {
        awaiting_approval: true,
        escalation_id: approval.escalationId,
        reason: approval.reason,
      },
    });

    logger.info(
      { taskId: task.id, targetAgent, escalationId: approval.escalationId },
      'Task awaiting approval'
    );
    return;
  }

  // Route to target agent
  await sendAgentMessage({
    from_agent: 'orchestrator',
    to_agent: targetAgent,
    message_type: 'execute_task',
    payload: { task_id: task.id, task },
  });

  // Update task status
  await upsertTask({
    ...task,
    agent_name: targetAgent,
    status: 'claimed',
    claimed_at: new Date().toISOString(),
  });

  await logAction({
    client_id: task.client_id,
    agent_name: 'orchestrator',
    action_type: 'task_routed',
    entity_type: 'task',
    entity_id: task.id ?? 'unknown',
    description: `Routed ${taskType} to ${targetAgent} for ${client.name}`,
    status: 'success',
  });

  logger.info({ taskId: task.id, taskType, targetAgent, clientName: client.name }, 'Task routed');
}

export function getAgentForTask(taskType: TaskType): AgentName | undefined {
  return TASK_TO_AGENT[taskType];
}

export async function resolveConflict(
  tasks: AgentTask[]
): Promise<AgentTask> {
  // If multiple agents want to change the same campaign/adset,
  // prioritize by: 1) task priority, 2) safety (pause > budget change > scale)
  const priorityOrder: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const safetyOrder: Record<string, number> = {
    meta_pause_ad: 10,
    meta_pause_adset: 10,
    meta_budget_decrease: 8,
    google_pause_campaign: 10,
    meta_budget_increase: 3,
    meta_scale_winner: 2,
    meta_duplicate_adset: 1,
    meta_create_campaign: 0,
  };

  const sorted = [...tasks].sort((a, b) => {
    // Priority first
    const aPri = priorityOrder[a.priority] ?? 0;
    const bPri = priorityOrder[b.priority] ?? 0;
    if (aPri !== bPri) return bPri - aPri;

    // Then safety (higher = safer/more conservative)
    const aSafety = safetyOrder[a.task_type] ?? 5;
    const bSafety = safetyOrder[b.task_type] ?? 5;
    return bSafety - aSafety;
  });

  const winner = sorted[0];

  // Mark losing tasks as skipped
  for (const task of sorted.slice(1)) {
    await logAction({
      client_id: task.client_id,
      agent_name: 'orchestrator',
      action_type: 'conflict_resolution',
      entity_type: 'task',
      entity_id: task.id ?? 'unknown',
      description: `Skipped due to conflict — ${winner.task_type} (${winner.agent_name}) takes priority`,
      status: 'skipped',
    });

    await upsertTask({
      ...task,
      status: 'completed',
      result: { skipped: true, reason: `Conflict resolved in favor of ${winner.task_type}` },
    });
  }

  logger.info(
    { winnerId: winner.id, winnerType: winner.task_type, conflictCount: tasks.length },
    'Conflict resolved'
  );

  return winner;
}
