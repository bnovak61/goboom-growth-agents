import { createLogger } from '../../shared/utils/logger.js';
import {
  ClientRecord,
  updateAgentHeartbeat,
  upsertTask,
  logAction,
  getUnreadMessages,
  markMessagesRead,
  AgentTask,
} from '../../shared/clients/supabase.js';
import { forEachClient } from '../../shared/multi-client.js';
import { MetaAdsAnalyzer } from './analyzer.js';
import { MetaAdsExecutor } from './executor.js';
import { FullAnalysisResult, ProposedAction } from './types.js';

const logger = createLogger('meta-ads-engineer');

export class MetaAdsEngineer {
  private analyzer: MetaAdsAnalyzer;
  private executor: MetaAdsExecutor;
  private running = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private dryRun: boolean;

  constructor(config?: { dryRun?: boolean }) {
    this.analyzer = new MetaAdsAnalyzer();
    this.executor = new MetaAdsExecutor();
    this.dryRun = config?.dryRun ?? false;
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    logger.info({ dryRun: this.dryRun }, 'Meta Ads Engineer starting');

    await updateAgentHeartbeat('meta-ads-engineer', 'running', 'Initializing');

    // Heartbeat every 30s
    this.heartbeatTimer = setInterval(async () => {
      await updateAgentHeartbeat('meta-ads-engineer', 'running');
    }, 30_000);

    // Run first cycle immediately
    await this.runCycle();

    // Schedule analysis every 2 hours
    this.intervalTimer = setInterval(async () => {
      try {
        await this.runCycle();
      } catch (error) {
        logger.error({ error }, 'Analysis cycle failed');
      }
    }, 2 * 60 * 60 * 1000);

    // Also check for orchestrator messages every 60 seconds
    setInterval(async () => {
      try {
        await this.processMessages();
      } catch (error) {
        logger.error({ error }, 'Message processing failed');
      }
    }, 60_000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await updateAgentHeartbeat('meta-ads-engineer', 'stopped');
    logger.info('Meta Ads Engineer stopped');
  }

  async runCycle(): Promise<void> {
    logger.info('Starting Meta Ads analysis cycle');
    await updateAgentHeartbeat('meta-ads-engineer', 'running', 'Running analysis cycle');

    const { succeeded, failed } = await forEachClient(
      async (client) => {
        await this.analyzeAndAct(client);
      },
      {
        platforms: ['meta'],
        concurrency: 2,
        agentName: 'meta-ads-engineer',
      }
    );

    logger.info({ succeeded: succeeded.length, failed: failed.length }, 'Analysis cycle complete');
    await updateAgentHeartbeat('meta-ads-engineer', 'idle', 'Waiting for next cycle');
  }

  async analyzeAndAct(client: ClientRecord): Promise<FullAnalysisResult> {
    await updateAgentHeartbeat(
      'meta-ads-engineer',
      'running',
      `Analyzing ${client.name}`
    );

    // Run full analysis
    const result = await this.analyzer.analyzeClient(client);

    // Separate auto-execute actions from those needing approval
    const autoActions = result.proposedActions.filter((a) => a.auto_execute);
    const approvalActions = result.proposedActions.filter((a) => !a.auto_execute);

    // Execute auto-approved actions
    if (autoActions.length > 0) {
      const execResult = await this.executor.executeActions(
        client,
        autoActions,
        this.dryRun
      );

      logger.info(
        {
          clientName: client.name,
          executed: execResult.executed,
          failed: execResult.failed,
        },
        'Auto-execute actions processed'
      );
    }

    // Create tasks for approval-required actions
    for (const action of approvalActions) {
      await upsertTask({
        client_id: client.id,
        agent_name: 'meta-ads-engineer',
        task_type: action.action_type,
        status: 'pending',
        priority: this.actionToPriority(action),
        payload: {
          campaign_id: action.metadata?.campaign_id,
          adset_id: action.entity_type === 'adset' ? action.entity_id : undefined,
          ad_id: action.entity_type === 'ad' ? action.entity_id : undefined,
        },
        proposed_action: {
          ...action,
          analysis_timestamp: result.timestamp,
        },
      });
    }

    // Log analysis summary
    await logAction({
      client_id: client.id,
      agent_name: 'meta-ads-engineer',
      action_type: 'analysis_complete',
      entity_type: 'client',
      entity_id: client.id,
      description: `Analysis complete: ${result.campaigns.length} campaigns, ${result.summary.totalLeads} leads, $${result.summary.avgCpl.toFixed(2)} avg CPL. ${autoActions.length} auto-executed, ${approvalActions.length} pending approval.`,
      status: 'success',
      metadata: {
        summary: result.summary,
        claude_insights: result.claudeInsights?.substring(0, 500),
      },
    });

    return result;
  }

  async executeApprovedTask(task: AgentTask, client: ClientRecord): Promise<void> {
    const action = task.proposed_action as unknown as ProposedAction;
    if (!action) {
      logger.warn({ taskId: task.id }, 'No proposed action in task');
      return;
    }

    const result = await this.executor.executeAction(client, action, this.dryRun);

    if (result.success) {
      logger.info({ taskId: task.id, action: action.action_type }, 'Approved task executed');
    } else {
      logger.error({ taskId: task.id, error: result.error }, 'Approved task execution failed');
    }
  }

  private async processMessages(): Promise<void> {
    const messages = await getUnreadMessages('meta-ads-engineer');
    if (messages.length === 0) return;

    for (const message of messages) {
      if (message.message_type === 'execute_task') {
        const task = message.payload.task as AgentTask | undefined;
        if (task) {
          const client = await import('../../shared/clients/supabase.js').then((m) =>
            m.getClient(task.client_id)
          );
          if (client) {
            await this.executeApprovedTask(task, client);
          }
        }
      }
    }

    await markMessagesRead(messages.map((m) => m.id!).filter(Boolean));
  }

  private actionToPriority(action: ProposedAction): 'low' | 'medium' | 'high' | 'critical' {
    if (action.action_type.includes('pause') || action.action_type.includes('decrease')) {
      return 'high';
    }
    if (action.action_type.includes('scale') || action.action_type.includes('create')) {
      return 'medium';
    }
    return 'medium';
  }
}

export { MetaAdsAnalyzer } from './analyzer.js';
export { MetaAdsExecutor } from './executor.js';
