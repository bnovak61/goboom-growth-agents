import { createLogger } from '../../shared/utils/logger.js';
import {
  getPendingTasks,
  getAgentStates,
  updateAgentHeartbeat,
  getPendingEscalations,
  respondToEscalation,
  getSupabase,
  AgentTask,
  upsertTask,
  logAction,
  completeTask,
} from '../../shared/clients/supabase.js';
import { routeTask, resolveConflict } from './task-router.js';
import {
  OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './types.js';

const logger = createLogger('orchestrator');

export class Orchestrator {
  private config: OrchestratorConfig;
  private running = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Orchestrator already running');
      return;
    }

    this.running = true;
    logger.info({ config: this.config }, 'Starting orchestrator');

    await updateAgentHeartbeat('orchestrator', 'running', 'Initializing');

    // Start heartbeat
    this.heartbeatTimer = setInterval(async () => {
      await updateAgentHeartbeat('orchestrator', 'running');
    }, this.config.heartbeatIntervalMs);

    // Run first tick immediately
    await this.tick();

    // Start tick loop
    this.tickTimer = setInterval(async () => {
      try {
        await this.tick();
      } catch (error) {
        logger.error({ error }, 'Orchestrator tick failed');
      }
    }, this.config.tickIntervalMs);

    logger.info('Orchestrator running');
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await updateAgentHeartbeat('orchestrator', 'stopped');
    logger.info('Orchestrator stopped');
  }

  private async tick(): Promise<void> {
    const startTime = Date.now();
    logger.debug('Orchestrator tick starting');

    await updateAgentHeartbeat('orchestrator', 'running', 'Processing tick');

    // 1. Check for new pending tasks
    await this.processNewTasks();

    // 2. Check for approval responses
    await this.processApprovalResponses();

    // 3. Check agent heartbeats for stale agents
    await this.checkAgentHealth();

    // 4. Check for expired escalations
    await this.checkExpiredEscalations();

    logger.debug({ duration: Date.now() - startTime }, 'Orchestrator tick complete');
  }

  private async processNewTasks(): Promise<void> {
    const tasks = await getPendingTasks();

    if (tasks.length === 0) return;

    logger.info({ count: tasks.length }, 'Processing pending tasks');

    // Group by entity (campaign/adset) to detect conflicts
    const entityGroups = new Map<string, AgentTask[]>();
    for (const task of tasks) {
      const entityKey = this.getEntityKey(task);
      if (entityKey) {
        const group = entityGroups.get(entityKey) ?? [];
        group.push(task);
        entityGroups.set(entityKey, group);
      } else {
        // No entity conflict possible, route directly
        await routeTask(task);
      }
    }

    // Resolve conflicts and route winners
    for (const [entityKey, group] of entityGroups) {
      if (group.length === 1) {
        await routeTask(group[0]);
      } else {
        logger.info({ entityKey, count: group.length }, 'Resolving task conflict');
        const winner = await resolveConflict(group);
        await routeTask(winner);
      }
    }
  }

  private getEntityKey(task: AgentTask): string | null {
    const payload = task.payload ?? {};
    const campaignId = payload.campaign_id as string | undefined;
    const adsetId = payload.adset_id as string | undefined;
    const adId = payload.ad_id as string | undefined;

    if (adId) return `ad:${adId}`;
    if (adsetId) return `adset:${adsetId}`;
    if (campaignId) return `campaign:${campaignId}`;
    return null;
  }

  private async processApprovalResponses(): Promise<void> {
    // Look for escalations that have been responded to (approved/rejected)
    const { data: respondedEscalations, error } = await getSupabase()
      .from('agent_escalations')
      .select('*')
      .in('status', ['approved', 'rejected'])
      .not('task_id', 'is', null)
      .order('responded_at', { ascending: true })
      .limit(20);

    if (error || !respondedEscalations?.length) return;

    for (const escalation of respondedEscalations) {
      if (escalation.status === 'approved') {
        // Re-queue the task with approval override
        const { data: task } = await getSupabase()
          .from('agent_tasks')
          .select('*')
          .eq('id', escalation.task_id)
          .single();

        if (task) {
          await upsertTask({
            ...task,
            status: 'pending',
            result: { approved: true, approved_by: escalation.responded_by },
          });

          await logAction({
            client_id: escalation.client_id,
            agent_name: 'orchestrator',
            action_type: 'approval_processed',
            entity_type: 'escalation',
            entity_id: escalation.id,
            description: `Approved by ${escalation.responded_by}: ${escalation.description}`,
            status: 'success',
          });
        }
      } else {
        // Rejected — mark task as completed/skipped
        if (escalation.task_id) {
          await completeTask(escalation.task_id, {
            rejected: true,
            rejected_by: escalation.responded_by,
            notes: escalation.response_notes,
          });
        }

        await logAction({
          client_id: escalation.client_id,
          agent_name: 'orchestrator',
          action_type: 'approval_rejected',
          entity_type: 'escalation',
          entity_id: escalation.id,
          description: `Rejected by ${escalation.responded_by}: ${escalation.description}`,
          status: 'skipped',
        });
      }

      // Mark escalation as processed by setting a processed flag
      await getSupabase()
        .from('agent_escalations')
        .update({ status: escalation.status === 'approved' ? 'approved' : 'rejected' })
        .eq('id', escalation.id);
    }
  }

  private async checkAgentHealth(): Promise<void> {
    const states = await getAgentStates();
    const now = Date.now();

    for (const state of states) {
      if (state.agent_name === 'orchestrator') continue;

      if (state.status === 'running') {
        const lastBeat = new Date(state.last_heartbeat).getTime();
        const staleDuration = now - lastBeat;

        if (staleDuration > this.config.staleAgentThresholdMs) {
          logger.warn(
            { agent: state.agent_name, staleDuration },
            'Agent appears stale — marking as error'
          );

          await updateAgentHeartbeat(state.agent_name, 'error', 'Stale — no heartbeat');

          await logAction({
            client_id: 'system',
            agent_name: 'orchestrator',
            action_type: 'agent_stale',
            entity_type: 'agent',
            entity_id: state.agent_name,
            description: `Agent ${state.agent_name} has not sent heartbeat for ${Math.round(staleDuration / 1000)}s`,
            status: 'failed',
          });
        }
      }
    }
  }

  private async checkExpiredEscalations(): Promise<void> {
    const { data: expired, error } = await getSupabase()
      .from('agent_escalations')
      .select('*')
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());

    if (error || !expired?.length) return;

    for (const escalation of expired) {
      await respondToEscalation(escalation.id, 'rejected', 'system', 'Auto-expired after timeout');

      await logAction({
        client_id: escalation.client_id,
        agent_name: 'orchestrator',
        action_type: 'escalation_expired',
        entity_type: 'escalation',
        entity_id: escalation.id,
        description: `Escalation expired: ${escalation.description}`,
        status: 'failed',
      });

      logger.info({ escalationId: escalation.id }, 'Escalation expired');
    }
  }
}

// Standalone entry point
async function main(): Promise<void> {
  const orchestrator = new Orchestrator();

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down');
    await orchestrator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down');
    await orchestrator.stop();
    process.exit(0);
  });

  await orchestrator.start();
}

main().catch((error) => {
  logger.error({ error }, 'Orchestrator failed to start');
  process.exit(1);
});
