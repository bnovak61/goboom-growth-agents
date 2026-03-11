import { createLogger } from '../../shared/utils/logger.js';
import { facebookAds } from '../../shared/clients/facebook-ads.js';
import { instantly } from '../../shared/clients/instantly.js';
import { AdPerformance, Campaign } from '../../shared/types/campaign.types.js';

const logger = createLogger('dashboard-builder');

export interface DashboardMetrics {
  timestamp: Date;
  facebook?: FacebookMetrics;
  email?: EmailMetrics;
  leads?: LeadMetrics;
}

export interface FacebookMetrics {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  averageCpm: number;
  averageCpc: number;
  averageCtr: number;
  activeCampaigns: number;
  activeAds: number;
  topPerformingAds: Array<{
    id: string;
    name: string;
    ctr: number;
    spend: number;
  }>;
  underperformingAds: Array<{
    id: string;
    name: string;
    cpm: number;
    ctr: number;
  }>;
}

export interface EmailMetrics {
  totalLeads: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

export interface LeadMetrics {
  totalLeads: number;
  newThisWeek: number;
  enrichedCount: number;
  verifiedCount: number;
  contactedCount: number;
  respondedCount: number;
  conversionRate: number;
}

export interface DashboardConfig {
  refreshIntervalMs?: number;
  facebookDateRange?: 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d';
  instantlyCampaignIds?: string[];
}

export class DashboardBuilder {
  private config: DashboardConfig;
  private cachedMetrics: DashboardMetrics | null = null;
  private lastRefresh: Date | null = null;

  constructor(config: DashboardConfig = {}) {
    this.config = {
      refreshIntervalMs: 5 * 60 * 1000, // 5 minutes
      facebookDateRange: 'last_7d',
      ...config,
    };
  }

  async getMetrics(forceRefresh: boolean = false): Promise<DashboardMetrics> {
    const now = new Date();

    if (
      !forceRefresh &&
      this.cachedMetrics &&
      this.lastRefresh &&
      now.getTime() - this.lastRefresh.getTime() < this.config.refreshIntervalMs!
    ) {
      return this.cachedMetrics;
    }

    logger.info('Refreshing dashboard metrics');

    const metrics: DashboardMetrics = {
      timestamp: now,
    };

    try {
      metrics.facebook = await this.getFacebookMetrics();
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch Facebook metrics');
    }

    try {
      metrics.email = await this.getEmailMetrics();
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch email metrics');
    }

    this.cachedMetrics = metrics;
    this.lastRefresh = now;

    return metrics;
  }

  private async getFacebookMetrics(): Promise<FacebookMetrics> {
    const campaigns = await facebookAds.getCampaigns();
    const activeCampaigns = campaigns.filter((c) => c.status === 'active');

    let allAds: Array<{ id: string; name: string; adSetId: string }> = [];
    let allPerformance: AdPerformance[] = [];

    for (const campaign of activeCampaigns) {
      const adSets = await facebookAds.getAdSets(campaign.id);
      for (const adSet of adSets) {
        const ads = await facebookAds.getAds(adSet.id);
        const activeAds = ads.filter((a) => a.status === 'active');
        allAds.push(...activeAds.map((a) => ({ id: a.id, name: a.name, adSetId: a.adSetId })));
      }
    }

    if (allAds.length > 0) {
      allPerformance = await facebookAds.getAdInsights(
        allAds.map((a) => a.id),
        this.config.facebookDateRange
      );
    }

    const totalSpend = allPerformance.reduce((sum, p) => sum + p.spend, 0);
    const totalImpressions = allPerformance.reduce((sum, p) => sum + p.impressions, 0);
    const totalClicks = allPerformance.reduce((sum, p) => sum + p.clicks, 0);
    const totalConversions = allPerformance.reduce(
      (sum, p) => sum + (p.conversions ?? 0),
      0
    );

    const averageCpm =
      totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const averageCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const averageCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Sort by CTR for top performers
    const sortedByPerformance = [...allPerformance].sort((a, b) => b.ctr - a.ctr);
    const topPerformingAds = sortedByPerformance.slice(0, 5).map((p) => {
      const ad = allAds.find((a) => a.id === p.adId);
      return {
        id: p.adId,
        name: ad?.name ?? 'Unknown',
        ctr: p.ctr,
        spend: p.spend,
      };
    });

    // Sort by CPM for underperformers
    const sortedByUnderperformance = [...allPerformance].sort((a, b) => b.cpm - a.cpm);
    const underperformingAds = sortedByUnderperformance
      .filter((p) => p.cpm > 50 || p.ctr < 0.5)
      .slice(0, 5)
      .map((p) => {
        const ad = allAds.find((a) => a.id === p.adId);
        return {
          id: p.adId,
          name: ad?.name ?? 'Unknown',
          cpm: p.cpm,
          ctr: p.ctr,
        };
      });

    return {
      totalSpend,
      totalImpressions,
      totalClicks,
      totalConversions,
      averageCpm,
      averageCpc,
      averageCtr,
      activeCampaigns: activeCampaigns.length,
      activeAds: allAds.length,
      topPerformingAds,
      underperformingAds,
    };
  }

  private async getEmailMetrics(): Promise<EmailMetrics> {
    if (!this.config.instantlyCampaignIds?.length) {
      return this.getEmptyEmailMetrics();
    }

    let totalLeads = 0;
    let contacted = 0;
    let opened = 0;
    let clicked = 0;
    let replied = 0;
    let bounced = 0;

    for (const campaignId of this.config.instantlyCampaignIds) {
      try {
        const analytics = await instantly.getCampaignAnalytics(campaignId);
        totalLeads += analytics.total_leads;
        contacted += analytics.contacted;
        opened += analytics.opened;
        clicked += analytics.clicked;
        replied += analytics.replied;
        bounced += analytics.bounced;
      } catch (error) {
        logger.warn({ campaignId, error }, 'Failed to fetch campaign analytics');
      }
    }

    return {
      totalLeads,
      contacted,
      opened,
      clicked,
      replied,
      bounced,
      openRate: contacted > 0 ? (opened / contacted) * 100 : 0,
      clickRate: opened > 0 ? (clicked / opened) * 100 : 0,
      replyRate: contacted > 0 ? (replied / contacted) * 100 : 0,
      bounceRate: totalLeads > 0 ? (bounced / totalLeads) * 100 : 0,
    };
  }

  private getEmptyEmailMetrics(): EmailMetrics {
    return {
      totalLeads: 0,
      contacted: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      bounced: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0,
      bounceRate: 0,
    };
  }

  generateSummaryReport(metrics: DashboardMetrics): string {
    const lines: string[] = [];
    lines.push(`Dashboard Report - ${metrics.timestamp.toISOString()}`);
    lines.push('='.repeat(50));

    if (metrics.facebook) {
      const fb = metrics.facebook;
      lines.push('\nFacebook Ads');
      lines.push('-'.repeat(20));
      lines.push(`Active Campaigns: ${fb.activeCampaigns}`);
      lines.push(`Active Ads: ${fb.activeAds}`);
      lines.push(`Total Spend: $${fb.totalSpend.toFixed(2)}`);
      lines.push(`Impressions: ${fb.totalImpressions.toLocaleString()}`);
      lines.push(`Clicks: ${fb.totalClicks.toLocaleString()}`);
      lines.push(`CTR: ${fb.averageCtr.toFixed(2)}%`);
      lines.push(`CPM: $${fb.averageCpm.toFixed(2)}`);
      lines.push(`CPC: $${fb.averageCpc.toFixed(2)}`);

      if (fb.topPerformingAds.length > 0) {
        lines.push('\nTop Performers:');
        fb.topPerformingAds.forEach((ad, i) => {
          lines.push(`  ${i + 1}. ${ad.name} - CTR: ${ad.ctr.toFixed(2)}%`);
        });
      }

      if (fb.underperformingAds.length > 0) {
        lines.push('\nUnderperforming Ads:');
        fb.underperformingAds.forEach((ad, i) => {
          lines.push(`  ${i + 1}. ${ad.name} - CPM: $${ad.cpm.toFixed(2)}`);
        });
      }
    }

    if (metrics.email) {
      const email = metrics.email;
      lines.push('\nEmail Campaigns');
      lines.push('-'.repeat(20));
      lines.push(`Total Leads: ${email.totalLeads}`);
      lines.push(`Contacted: ${email.contacted}`);
      lines.push(`Open Rate: ${email.openRate.toFixed(1)}%`);
      lines.push(`Click Rate: ${email.clickRate.toFixed(1)}%`);
      lines.push(`Reply Rate: ${email.replyRate.toFixed(1)}%`);
      lines.push(`Bounce Rate: ${email.bounceRate.toFixed(1)}%`);
    }

    return lines.join('\n');
  }

  toJSON(metrics: DashboardMetrics): object {
    return {
      timestamp: metrics.timestamp.toISOString(),
      facebook: metrics.facebook,
      email: metrics.email,
      leads: metrics.leads,
    };
  }
}

export const dashboardBuilder = new DashboardBuilder();
