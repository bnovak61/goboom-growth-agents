import { createLogger } from '../../shared/utils/logger.js';
import {
  ClientRecord,
  updateAgentHeartbeat,
  logAction,
  getSupabase,
} from '../../shared/clients/supabase.js';
import { forEachClient } from '../../shared/multi-client.js';

const logger = createLogger('client-reporter');

export interface ClientReport {
  clientId: string;
  clientName: string;
  period: string;
  generatedAt: string;
  metrics: {
    totalSpend: number;
    totalLeads: number;
    avgCpl: number;
    avgCtr: number;
    impressions: number;
    clicks: number;
  };
  agentActions: {
    totalActions: number;
    autoExecuted: number;
    approvalRequired: number;
    actionsBreakdown: Record<string, number>;
  };
  highlights: string[];
  recommendations: string[];
}

export class ClientReporter {
  private running = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Client Reporter starting');
    await updateAgentHeartbeat('client-reporter', 'running', 'Initializing');

    this.heartbeatTimer = setInterval(async () => {
      await updateAgentHeartbeat('client-reporter', 'running');
    }, 30_000);

    // Generate reports daily at startup check, then weekly
    await updateAgentHeartbeat('client-reporter', 'idle', 'Waiting for report schedule');

    // Weekly report every Monday at 8am (check every hour)
    this.intervalTimer = setInterval(async () => {
      const now = new Date();
      if (now.getDay() === 1 && now.getHours() === 8) {
        try {
          await this.generateWeeklyReports();
        } catch (error) {
          logger.error({ error }, 'Weekly report generation failed');
        }
      }
    }, 60 * 60 * 1000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await updateAgentHeartbeat('client-reporter', 'stopped');
    logger.info('Client Reporter stopped');
  }

  async generateWeeklyReports(): Promise<ClientReport[]> {
    logger.info('Generating weekly reports');
    await updateAgentHeartbeat('client-reporter', 'running', 'Generating weekly reports');

    const reports: ClientReport[] = [];

    await forEachClient(
      async (client) => {
        const report = await this.generateReport(client, 'weekly');
        reports.push(report);
      },
      {
        concurrency: 3,
        agentName: 'client-reporter',
      }
    );

    await updateAgentHeartbeat('client-reporter', 'idle', 'Reports complete');
    return reports;
  }

  async generateReport(client: ClientRecord, period: 'weekly' | 'monthly'): Promise<ClientReport> {
    const days = period === 'weekly' ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch action log for the period
    const { data: actions } = await getSupabase()
      .from('agent_action_log')
      .select('*')
      .eq('client_id', client.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    const actionsList = actions ?? [];

    // Count action types
    const actionsBreakdown: Record<string, number> = {};
    for (const action of actionsList) {
      actionsBreakdown[action.action_type] = (actionsBreakdown[action.action_type] ?? 0) + 1;
    }

    const report: ClientReport = {
      clientId: client.id,
      clientName: client.name,
      period: `${period} (${days} days)`,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalSpend: 0,
        totalLeads: 0,
        avgCpl: 0,
        avgCtr: 0,
        impressions: 0,
        clicks: 0,
      },
      agentActions: {
        totalActions: actionsList.length,
        autoExecuted: actionsList.filter((a) => a.status === 'success').length,
        approvalRequired: actionsList.filter((a) => a.status === 'pending').length,
        actionsBreakdown,
      },
      highlights: this.generateHighlights(actionsList),
      recommendations: [],
    };

    await logAction({
      client_id: client.id,
      agent_name: 'client-reporter',
      action_type: 'generate_report',
      entity_type: 'client',
      entity_id: client.id,
      description: `Generated ${period} report for ${client.name}: ${actionsList.length} actions taken`,
      status: 'success',
      metadata: { report_summary: report.agentActions },
    });

    return report;
  }

  private generateHighlights(actions: any[]): string[] {
    const highlights: string[] = [];

    const successActions = actions.filter((a) => a.status === 'success');
    if (successActions.length > 0) {
      highlights.push(`${successActions.length} optimization actions executed successfully`);
    }

    const pauseActions = actions.filter((a) => a.action_type.includes('pause'));
    if (pauseActions.length > 0) {
      highlights.push(`${pauseActions.length} underperforming ads/ad sets paused`);
    }

    const budgetActions = actions.filter((a) => a.action_type.includes('budget'));
    if (budgetActions.length > 0) {
      highlights.push(`${budgetActions.length} budget adjustments made`);
    }

    return highlights;
  }
}
