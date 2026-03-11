import { createLogger } from '../../shared/utils/logger.js';
import { facebookAds } from '../../shared/clients/facebook-ads.js';
import { slack } from '../../shared/clients/slack.js';
import {
  AdPerformance,
  OptimizationRule,
  Ad,
  Campaign,
  AdSet,
} from '../../shared/types/campaign.types.js';
import { getEnv } from '../../config/index.js';

const logger = createLogger('facebook-ads-optimizer');

export interface OptimizationResult {
  adId: string;
  adName: string;
  rule: OptimizationRule;
  action: 'paused' | 'budget_increased' | 'budget_decreased' | 'notified';
  previousValue: number;
  newValue?: number;
  metrics: AdPerformance;
}

export interface OptimizationConfig {
  rules: OptimizationRule[];
  notifySlackChannel?: string;
  dryRun?: boolean;
}

const DEFAULT_RULES: OptimizationRule[] = [
  {
    id: 'pause-high-cpm',
    name: 'Pause High CPM Ads',
    enabled: true,
    condition: {
      metric: 'cpm',
      operator: 'gt',
      value: 50,
      timeRange: 'last_3_days',
    },
    action: 'pause',
    priority: 1,
  },
  {
    id: 'pause-low-ctr',
    name: 'Pause Low CTR Ads',
    enabled: true,
    condition: {
      metric: 'ctr',
      operator: 'lt',
      value: 0.5,
      timeRange: 'last_7_days',
    },
    action: 'pause',
    priority: 2,
  },
  {
    id: 'increase-budget-winners',
    name: 'Increase Budget for Winners',
    enabled: true,
    condition: {
      metric: 'ctr',
      operator: 'gt',
      value: 2.0,
      timeRange: 'last_7_days',
    },
    action: 'increase_budget',
    actionValue: 20, // 20% increase
    priority: 3,
  },
  {
    id: 'notify-high-frequency',
    name: 'Notify High Frequency',
    enabled: true,
    condition: {
      metric: 'frequency',
      operator: 'gt',
      value: 3.0,
      timeRange: 'last_7_days',
    },
    action: 'notify',
    priority: 4,
  },
  {
    id: 'decrease-budget-losers',
    name: 'Decrease Budget for Losers',
    enabled: true,
    condition: {
      metric: 'cpc',
      operator: 'gt',
      value: 5.0,
      timeRange: 'last_7_days',
    },
    action: 'decrease_budget',
    actionValue: 30, // 30% decrease
    priority: 5,
  },
];

export class FacebookAdsOptimizer {
  private config: OptimizationConfig;

  constructor(config?: Partial<OptimizationConfig>) {
    this.config = {
      rules: config?.rules ?? DEFAULT_RULES,
      notifySlackChannel: config?.notifySlackChannel,
      dryRun: config?.dryRun ?? false,
    };
  }

  async optimize(): Promise<OptimizationResult[]> {
    logger.info({ dryRun: this.config.dryRun }, 'Starting optimization run');

    const results: OptimizationResult[] = [];

    try {
      // Get all active campaigns
      const campaigns = await facebookAds.getCampaigns();
      const activeCampaigns = campaigns.filter((c) => c.status === 'active');

      logger.info({ count: activeCampaigns.length }, 'Found active campaigns');

      for (const campaign of activeCampaigns) {
        const campaignResults = await this.optimizeCampaign(campaign);
        results.push(...campaignResults);
      }

      // Send summary notification
      if (results.length > 0 && this.config.notifySlackChannel) {
        await this.sendSummaryNotification(results);
      }

      logger.info({ totalActions: results.length }, 'Optimization run complete');
    } catch (error) {
      logger.error({ error }, 'Optimization run failed');
      throw error;
    }

    return results;
  }

  private async optimizeCampaign(campaign: Campaign): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];

    // Get ad sets for this campaign
    const adSets = await facebookAds.getAdSets(campaign.id);
    const activeAdSets = adSets.filter((as) => as.status === 'active');

    for (const adSet of activeAdSets) {
      const adSetResults = await this.optimizeAdSet(adSet);
      results.push(...adSetResults);
    }

    return results;
  }

  private async optimizeAdSet(adSet: AdSet): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];

    // Get ads for this ad set
    const ads = await facebookAds.getAds(adSet.id);
    const activeAds = ads.filter((ad) => ad.status === 'active');

    if (activeAds.length === 0) return results;

    // Get performance metrics
    const adIds = activeAds.map((ad) => ad.id);
    const performances = await facebookAds.getAdInsights(adIds, 'last_7d');

    const performanceMap = new Map(performances.map((p) => [p.adId, p]));

    for (const ad of activeAds) {
      const performance = performanceMap.get(ad.id);
      if (!performance) continue;

      const adResults = await this.evaluateAd(ad, performance, adSet);
      results.push(...adResults);
    }

    return results;
  }

  private async evaluateAd(
    ad: Ad,
    performance: AdPerformance,
    adSet: AdSet
  ): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];

    // Sort rules by priority
    const sortedRules = [...this.config.rules]
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (this.evaluateCondition(rule, performance)) {
        const result = await this.applyAction(ad, rule, performance, adSet);
        if (result) {
          results.push(result);
          // Only apply one action per ad (highest priority)
          break;
        }
      }
    }

    return results;
  }

  private evaluateCondition(
    rule: OptimizationRule,
    performance: AdPerformance
  ): boolean {
    const { metric, operator, value } = rule.condition;
    const actualValue = this.getMetricValue(performance, metric);

    if (actualValue === undefined || actualValue === null) return false;

    switch (operator) {
      case 'gt':
        return actualValue > value;
      case 'gte':
        return actualValue >= value;
      case 'lt':
        return actualValue < value;
      case 'lte':
        return actualValue <= value;
      case 'eq':
        return actualValue === value;
      default:
        return false;
    }
  }

  private getMetricValue(
    performance: AdPerformance,
    metric: OptimizationRule['condition']['metric']
  ): number | undefined {
    switch (metric) {
      case 'cpm':
        return performance.cpm;
      case 'cpc':
        return performance.cpc;
      case 'ctr':
        return performance.ctr;
      case 'spend':
        return performance.spend;
      case 'conversions':
        return performance.conversions;
      case 'frequency':
        return performance.frequency;
      default:
        return undefined;
    }
  }

  private async applyAction(
    ad: Ad,
    rule: OptimizationRule,
    performance: AdPerformance,
    adSet: AdSet
  ): Promise<OptimizationResult | null> {
    const metricValue = this.getMetricValue(
      performance,
      rule.condition.metric
    ) ?? 0;

    logger.info(
      {
        adId: ad.id,
        adName: ad.name,
        rule: rule.name,
        action: rule.action,
        metricValue,
        dryRun: this.config.dryRun,
      },
      'Applying optimization action'
    );

    let result: OptimizationResult | null = null;

    switch (rule.action) {
      case 'pause':
        if (!this.config.dryRun) {
          await facebookAds.pauseAd(ad.id);
        }
        result = {
          adId: ad.id,
          adName: ad.name,
          rule,
          action: 'paused',
          previousValue: metricValue,
          metrics: performance,
        };
        break;

      case 'increase_budget':
        if (adSet.dailyBudget) {
          const increase = rule.actionValue ?? 20;
          const newBudget = adSet.dailyBudget * (1 + increase / 100);
          if (!this.config.dryRun) {
            await facebookAds.updateAdSetBudget(adSet.id, newBudget);
          }
          result = {
            adId: ad.id,
            adName: ad.name,
            rule,
            action: 'budget_increased',
            previousValue: adSet.dailyBudget,
            newValue: newBudget,
            metrics: performance,
          };
        }
        break;

      case 'decrease_budget':
        if (adSet.dailyBudget) {
          const decrease = rule.actionValue ?? 30;
          const newBudget = Math.max(
            adSet.dailyBudget * (1 - decrease / 100),
            5 // Minimum budget
          );
          if (!this.config.dryRun) {
            await facebookAds.updateAdSetBudget(adSet.id, newBudget);
          }
          result = {
            adId: ad.id,
            adName: ad.name,
            rule,
            action: 'budget_decreased',
            previousValue: adSet.dailyBudget,
            newValue: newBudget,
            metrics: performance,
          };
        }
        break;

      case 'notify':
        result = {
          adId: ad.id,
          adName: ad.name,
          rule,
          action: 'notified',
          previousValue: metricValue,
          metrics: performance,
        };
        break;
    }

    return result;
  }

  private async sendSummaryNotification(
    results: OptimizationResult[]
  ): Promise<void> {
    if (!this.config.notifySlackChannel) return;

    const pausedCount = results.filter((r) => r.action === 'paused').length;
    const budgetChanges = results.filter(
      (r) =>
        r.action === 'budget_increased' || r.action === 'budget_decreased'
    ).length;

    const blocks = [
      slack.createMetricsBlock('Optimization Summary', {
        'Ads Paused': pausedCount,
        'Budget Changes': budgetChanges,
        'Notifications': results.filter((r) => r.action === 'notified').length,
        'Total Actions': results.length,
      }),
    ];

    const attachments = results.slice(0, 5).map((result) => {
      const color =
        result.action === 'paused'
          ? 'danger'
          : result.action === 'budget_increased'
          ? 'good'
          : 'warning';

      return slack.createAlertBlock(
        `${result.action.toUpperCase()}: ${result.adName}`,
        `Rule: ${result.rule.name}\nMetric: ${result.rule.condition.metric} = ${result.previousValue.toFixed(2)}${
          result.newValue ? ` → ${result.newValue.toFixed(2)}` : ''
        }`,
        color
      );
    });

    await slack.postMessage({
      channel: this.config.notifySlackChannel,
      text: `Facebook Ads Optimization: ${results.length} actions taken`,
      blocks,
      attachments,
    });
  }

  getDefaultRules(): OptimizationRule[] {
    return [...DEFAULT_RULES];
  }

  updateRules(rules: OptimizationRule[]): void {
    this.config.rules = rules;
  }

  setDryRun(dryRun: boolean): void {
    this.config.dryRun = dryRun;
  }
}

export const facebookAdsOptimizer = new FacebookAdsOptimizer();
