import { createLogger } from '../../shared/utils/logger.js';
import {
  ClientRecord,
  updateAgentHeartbeat,
  upsertTask,
  logAction,
} from '../../shared/clients/supabase.js';
import { forEachClient } from '../../shared/multi-client.js';
import { FacebookAdsClient } from '../../shared/clients/facebook-ads.js';
import { getBenchmark, getCplStatus } from '../meta-ads-engineer/benchmarks.js';

const logger = createLogger('performance-monitor');

interface AnomalyThresholds {
  cplSpikePercent: number;    // e.g., 30 = alert if CPL spikes 30% in 24h
  ctrDropPercent: number;     // e.g., 25 = alert if CTR drops 25%
  spendOverpacePercent: number; // e.g., 120 = alert if daily spend > 120% of budget
  zeroLeadsHours: number;     // e.g., 24 = alert if 0 leads in 24h with spend
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  cplSpikePercent: 30,
  ctrDropPercent: 25,
  spendOverpacePercent: 120,
  zeroLeadsHours: 24,
};

export class PerformanceMonitor {
  private running = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private thresholds: AnomalyThresholds;

  constructor(thresholds?: Partial<AnomalyThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Performance Monitor starting');
    await updateAgentHeartbeat('performance-monitor', 'running', 'Initializing');

    this.heartbeatTimer = setInterval(async () => {
      await updateAgentHeartbeat('performance-monitor', 'running');
    }, 30_000);

    // Run immediately
    await this.runCheck();

    // Check every hour
    this.intervalTimer = setInterval(async () => {
      try {
        await this.runCheck();
      } catch (error) {
        logger.error({ error }, 'Performance check failed');
      }
    }, 60 * 60 * 1000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await updateAgentHeartbeat('performance-monitor', 'stopped');
    logger.info('Performance Monitor stopped');
  }

  async runCheck(): Promise<void> {
    logger.info('Starting performance check');
    await updateAgentHeartbeat('performance-monitor', 'running', 'Running performance check');

    await forEachClient(
      async (client) => {
        await this.checkClient(client);
      },
      {
        platforms: ['meta'],
        concurrency: 3,
        agentName: 'performance-monitor',
      }
    );

    await updateAgentHeartbeat('performance-monitor', 'idle', 'Waiting for next check');
  }

  private async checkClient(client: ClientRecord): Promise<void> {
    if (!client.meta_access_token || !client.meta_ad_account_id) return;

    const fbClient = new FacebookAdsClient(
      client.meta_access_token,
      client.meta_ad_account_id
    );

    const benchmark = getBenchmark(client.practice_area);
    const targetCpl = client.target_cpl ?? benchmark.targetCpl;

    try {
      const campaigns = await fbClient.getCampaigns();
      const activeCampaigns = campaigns.filter((c) => c.status === 'active');

      for (const campaign of activeCampaigns) {
        const adSets = await fbClient.getAdSets(campaign.id);
        const activeAdSets = adSets.filter((as) => as.status === 'active');

        for (const adSet of activeAdSets) {
          const ads = await fbClient.getAds(adSet.id);
          const activeAds = ads.filter((a) => a.status === 'active');
          if (activeAds.length === 0) continue;

          const insights = await fbClient.getAdInsights(
            activeAds.map((a) => a.id),
            'today'
          );

          const totalSpend = insights.reduce((sum, i) => sum + i.spend, 0);
          const totalLeads = insights.reduce((sum, i) => sum + (i.conversions ?? 0), 0);
          const avgCtr = insights.length > 0
            ? insights.reduce((sum, i) => sum + i.ctr, 0) / insights.length
            : 0;

          // Check anomalies
          if (totalSpend > 0 && totalLeads === 0) {
            await this.createAnomaly(client, 'zero_leads_with_spend', {
              campaign: campaign.name,
              adset: adSet.name,
              spend: totalSpend,
            });
          }

          const currentCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
          if (currentCpl > targetCpl * (1 + this.thresholds.cplSpikePercent / 100)) {
            await this.createAnomaly(client, 'cpl_spike', {
              campaign: campaign.name,
              currentCpl,
              targetCpl,
              spikePercent: Math.round(((currentCpl - targetCpl) / targetCpl) * 100),
            });
          }

          const budget = adSet.dailyBudget ?? 0;
          if (budget > 0 && totalSpend > budget * (this.thresholds.spendOverpacePercent / 100)) {
            await this.createAnomaly(client, 'spend_overpace', {
              campaign: campaign.name,
              adset: adSet.name,
              spend: totalSpend,
              budget,
              pacePercent: Math.round((totalSpend / budget) * 100),
            });
          }
        }
      }

      await logAction({
        client_id: client.id,
        agent_name: 'performance-monitor',
        action_type: 'performance_check',
        entity_type: 'client',
        entity_id: client.id,
        description: `Performance check completed for ${client.name}`,
        status: 'success',
      });
    } catch (error) {
      logger.error({ clientId: client.id, error }, 'Performance check failed for client');
    }
  }

  private async createAnomaly(
    client: ClientRecord,
    anomalyType: string,
    details: Record<string, unknown>
  ): Promise<void> {
    logger.warn({ clientName: client.name, anomalyType, details }, 'Anomaly detected');

    await upsertTask({
      client_id: client.id,
      agent_name: 'performance-monitor',
      task_type: 'anomaly_detected',
      status: 'pending',
      priority: 'high',
      payload: {
        anomaly_type: anomalyType,
        ...details,
      },
      proposed_action: {
        action_type: 'anomaly_detected',
        entity_type: 'client' as const,
        entity_id: client.id,
        entity_name: client.name,
        description: `Anomaly: ${anomalyType} — ${JSON.stringify(details)}`,
        reasoning: `Automated detection by performance monitor`,
        auto_execute: false,
        expected_impact: 'Requires investigation',
      },
    });
  }
}
