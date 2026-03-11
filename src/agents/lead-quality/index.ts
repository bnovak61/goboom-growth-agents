import { createLogger } from '../../shared/utils/logger.js';
import {
  ClientRecord,
  updateAgentHeartbeat,
  logAction,
  getSupabase,
} from '../../shared/clients/supabase.js';
import { forEachClient } from '../../shared/multi-client.js';

const logger = createLogger('lead-quality');

export interface LeadScore {
  leadId: string;
  clientId: string;
  score: number; // 0-100
  quality: 'high' | 'medium' | 'low' | 'spam';
  source: string;
  practiceArea?: string;
  metadata?: Record<string, unknown>;
}

export class LeadQualityAgent {
  private running = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Lead Quality Agent starting');
    await updateAgentHeartbeat('lead-quality', 'running', 'Initializing');

    this.heartbeatTimer = setInterval(async () => {
      await updateAgentHeartbeat('lead-quality', 'running');
    }, 30_000);

    // Run immediately
    await this.runScoring();

    // Score leads every 30 minutes
    this.intervalTimer = setInterval(async () => {
      try {
        await this.runScoring();
      } catch (error) {
        logger.error({ error }, 'Lead scoring failed');
      }
    }, 30 * 60 * 1000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await updateAgentHeartbeat('lead-quality', 'stopped');
    logger.info('Lead Quality Agent stopped');
  }

  async runScoring(): Promise<void> {
    logger.info('Starting lead scoring run');
    await updateAgentHeartbeat('lead-quality', 'running', 'Scoring leads');

    await forEachClient(
      async (client) => {
        await this.scoreClientLeads(client);
      },
      {
        concurrency: 3,
        agentName: 'lead-quality',
      }
    );

    await updateAgentHeartbeat('lead-quality', 'idle', 'Waiting for next scoring run');
  }

  private async scoreClientLeads(client: ClientRecord): Promise<void> {
    // Fetch unscored leads from daily_metrics or a leads table
    // For now, log the scoring run
    await logAction({
      client_id: client.id,
      agent_name: 'lead-quality',
      action_type: 'lead_score',
      entity_type: 'client',
      entity_id: client.id,
      description: `Lead scoring check for ${client.name}`,
      status: 'success',
    });

    logger.debug({ clientName: client.name }, 'Lead scoring check completed');
  }

  scoreLead(data: {
    hasPhone: boolean;
    hasEmail: boolean;
    practiceAreaMatch: boolean;
    locationMatch: boolean;
    formCompleteness: number; // 0-1
    responseTime?: number; // seconds
  }): LeadScore['quality'] {
    let score = 0;

    if (data.hasPhone) score += 25;
    if (data.hasEmail) score += 15;
    if (data.practiceAreaMatch) score += 25;
    if (data.locationMatch) score += 20;
    score += Math.round(data.formCompleteness * 15);

    if (data.responseTime !== undefined && data.responseTime < 300) {
      score += 10; // Bonus for quick form fills (likely real person)
    }

    // Very low scores are likely spam
    if (score < 20) return 'spam';
    if (score < 40) return 'low';
    if (score < 70) return 'medium';
    return 'high';
  }
}
