import { createLogger } from '../../shared/utils/logger.js';
import {
  ClientRecord,
  updateAgentHeartbeat,
  upsertTask,
  logAction,
} from '../../shared/clients/supabase.js';
import { forEachClient } from '../../shared/multi-client.js';
import { FacebookAdsClient } from '../../shared/clients/facebook-ads.js';

const logger = createLogger('creative-strategist');

export class CreativeStrategist {
  private running = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    logger.info('Creative Strategist starting');
    await updateAgentHeartbeat('creative-strategist', 'running', 'Initializing');

    this.heartbeatTimer = setInterval(async () => {
      await updateAgentHeartbeat('creative-strategist', 'running');
    }, 30_000);

    // Run first check
    await this.runFatigueCheck();

    // Check every 6 hours
    this.intervalTimer = setInterval(async () => {
      try {
        await this.runFatigueCheck();
      } catch (error) {
        logger.error({ error }, 'Fatigue check failed');
      }
    }, 6 * 60 * 60 * 1000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await updateAgentHeartbeat('creative-strategist', 'stopped');
    logger.info('Creative Strategist stopped');
  }

  async runFatigueCheck(): Promise<void> {
    logger.info('Starting creative fatigue check');
    await updateAgentHeartbeat('creative-strategist', 'running', 'Checking creative fatigue');

    await forEachClient(
      async (client) => {
        await this.checkClientCreatives(client);
      },
      {
        platforms: ['meta'],
        concurrency: 2,
        agentName: 'creative-strategist',
      }
    );

    await updateAgentHeartbeat('creative-strategist', 'idle', 'Waiting for next check');
  }

  private async checkClientCreatives(client: ClientRecord): Promise<void> {
    if (!client.meta_access_token || !client.meta_ad_account_id) return;

    const fbClient = new FacebookAdsClient(
      client.meta_access_token,
      client.meta_ad_account_id
    );

    try {
      const campaigns = await fbClient.getCampaigns();
      const activeCampaigns = campaigns.filter((c) => c.status === 'active');

      for (const campaign of activeCampaigns) {
        const adSets = await fbClient.getAdSets(campaign.id);

        for (const adSet of adSets.filter((as) => as.status === 'active')) {
          const ads = await fbClient.getAds(adSet.id);
          const activeAds = ads.filter((a) => a.status === 'active');
          if (activeAds.length === 0) continue;

          const insights = await fbClient.getAdInsights(
            activeAds.map((a) => a.id),
            'last_7d'
          );

          const fatiguedAds = insights.filter(
            (i) => (i.frequency ?? 0) > 3 && i.ctr < 0.8
          );

          if (fatiguedAds.length > activeAds.length * 0.5) {
            await upsertTask({
              client_id: client.id,
              agent_name: 'creative-strategist',
              task_type: 'creative_brief',
              status: 'pending',
              priority: 'medium',
              payload: {
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                adset_id: adSet.id,
                adset_name: adSet.name,
                fatigued_count: fatiguedAds.length,
                total_active: activeAds.length,
              },
              proposed_action: {
                action_type: 'creative_brief',
                entity_type: 'adset' as const,
                entity_id: adSet.id,
                entity_name: adSet.name,
                description: `${fatiguedAds.length}/${activeAds.length} ads showing fatigue in ${adSet.name}. Need fresh creatives.`,
                reasoning: 'High frequency with low CTR indicates audience fatigue with current creatives',
                auto_execute: false,
                expected_impact: 'Refreshing creatives typically restores CTR by 30-50%',
              },
            });

            logger.info(
              {
                clientName: client.name,
                adSet: adSet.name,
                fatigued: fatiguedAds.length,
              },
              'Creative fatigue detected'
            );
          }
        }
      }

      await logAction({
        client_id: client.id,
        agent_name: 'creative-strategist',
        action_type: 'creative_fatigue_check',
        entity_type: 'client',
        entity_id: client.id,
        description: `Creative fatigue check completed for ${client.name}`,
        status: 'success',
      });
    } catch (error) {
      logger.error({ clientId: client.id, error }, 'Creative fatigue check failed');
    }
  }
}
