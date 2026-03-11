import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';
import {
  AdPerformance,
  Campaign,
  AdSet,
  Ad,
  AdStatus,
} from '../types/campaign.types.js';

interface FacebookCampaignResponse {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time: string;
  stop_time?: string;
  created_time: string;
  updated_time: string;
}

interface FacebookAdSetResponse {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time: string;
  end_time?: string;
  targeting: Record<string, unknown>;
}

interface FacebookAdResponse {
  id: string;
  name: string;
  adset_id: string;
  status: string;
  creative: {
    id: string;
  };
  created_time: string;
  updated_time: string;
}

interface FacebookInsightsResponse {
  data: Array<{
    ad_id: string;
    date_start: string;
    date_stop: string;
    impressions: string;
    reach: string;
    clicks: string;
    spend: string;
    cpm: string;
    cpc: string;
    ctr: string;
    conversions?: string;
    cost_per_conversion?: string;
    frequency?: string;
    actions?: Array<{ action_type: string; value: string }>;
  }>;
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

export class FacebookAdsClient extends BaseClient {
  private adAccountId: string;

  constructor(accessToken?: string, adAccountId?: string) {
    super(
      {
        baseUrl: 'https://graph.facebook.com/v18.0',
        apiKey: accessToken ?? requireEnv('FACEBOOK_ACCESS_TOKEN'),
        rateLimiter: defaultRateLimiters.facebook(),
      },
      'facebook-ads'
    );
    this.adAccountId = adAccountId ?? requireEnv('FACEBOOK_AD_ACCOUNT_ID');
  }

  private formatAdAccountId(): string {
    return this.adAccountId.startsWith('act_')
      ? this.adAccountId
      : `act_${this.adAccountId}`;
  }

  async getCampaigns(): Promise<Campaign[]> {
    const response = await this.get<{ data: FacebookCampaignResponse[] }>(
      `${this.formatAdAccountId()}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time`
    );

    return response.data.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      objective: this.mapObjective(campaign.objective),
      status: this.mapStatus(campaign.status),
      dailyBudget: campaign.daily_budget
        ? parseFloat(campaign.daily_budget) / 100
        : undefined,
      lifetimeBudget: campaign.lifetime_budget
        ? parseFloat(campaign.lifetime_budget) / 100
        : undefined,
      startDate: new Date(campaign.start_time),
      endDate: campaign.stop_time ? new Date(campaign.stop_time) : undefined,
      adSets: [],
      createdAt: new Date(campaign.created_time),
      updatedAt: new Date(campaign.updated_time),
    }));
  }

  async getAdSets(campaignId?: string): Promise<AdSet[]> {
    const endpoint = campaignId
      ? `${campaignId}/adsets`
      : `${this.formatAdAccountId()}/adsets`;

    const response = await this.get<{ data: FacebookAdSetResponse[] }>(
      `${endpoint}?fields=id,name,campaign_id,status,daily_budget,lifetime_budget,start_time,end_time,targeting`
    );

    return response.data.map((adset) => ({
      id: adset.id,
      name: adset.name,
      campaignId: adset.campaign_id,
      status: this.mapStatus(adset.status),
      dailyBudget: adset.daily_budget
        ? parseFloat(adset.daily_budget) / 100
        : undefined,
      lifetimeBudget: adset.lifetime_budget
        ? parseFloat(adset.lifetime_budget) / 100
        : undefined,
      startDate: new Date(adset.start_time),
      endDate: adset.end_time ? new Date(adset.end_time) : undefined,
      targeting: this.parseTargeting(adset.targeting),
    }));
  }

  async getAds(adSetId?: string): Promise<Ad[]> {
    const endpoint = adSetId
      ? `${adSetId}/ads`
      : `${this.formatAdAccountId()}/ads`;

    const response = await this.get<{ data: FacebookAdResponse[] }>(
      `${endpoint}?fields=id,name,adset_id,status,creative,created_time,updated_time`
    );

    return response.data.map((ad) => ({
      id: ad.id,
      name: ad.name,
      adSetId: ad.adset_id,
      status: this.mapStatus(ad.status),
      creative: {
        id: ad.creative.id,
        name: ad.name,
        type: 'image',
        headline: '',
        primaryText: '',
        callToAction: '',
        linkUrl: '',
        width: 1080,
        height: 1080,
        createdAt: new Date(ad.created_time),
      },
      createdAt: new Date(ad.created_time),
      updatedAt: new Date(ad.updated_time),
    }));
  }

  async getAdInsights(
    adIds: string[],
    datePreset:
      | 'today'
      | 'yesterday'
      | 'last_3d'
      | 'last_7d'
      | 'last_14d'
      | 'last_30d' = 'last_7d'
  ): Promise<AdPerformance[]> {
    const results: AdPerformance[] = [];

    for (const adId of adIds) {
      try {
        const response = await this.get<FacebookInsightsResponse>(
          `${adId}/insights?fields=ad_id,date_start,date_stop,impressions,reach,clicks,spend,cpm,cpc,ctr,conversions,cost_per_conversion,frequency,actions&date_preset=${datePreset}`
        );

        if (response.data && response.data.length > 0) {
          const insights = response.data[0];
          results.push({
            adId: insights.ad_id,
            dateStart: new Date(insights.date_start),
            dateEnd: new Date(insights.date_stop),
            impressions: parseInt(insights.impressions) || 0,
            reach: parseInt(insights.reach) || 0,
            clicks: parseInt(insights.clicks) || 0,
            spend: parseFloat(insights.spend) || 0,
            cpm: parseFloat(insights.cpm) || 0,
            cpc: parseFloat(insights.cpc) || 0,
            ctr: parseFloat(insights.ctr) || 0,
            conversions: insights.conversions
              ? parseInt(insights.conversions)
              : undefined,
            costPerConversion: insights.cost_per_conversion
              ? parseFloat(insights.cost_per_conversion)
              : undefined,
            frequency: insights.frequency
              ? parseFloat(insights.frequency)
              : undefined,
            actions: insights.actions
              ? Object.fromEntries(
                  insights.actions.map((a) => [a.action_type, parseInt(a.value)])
                )
              : undefined,
          });
        }
      } catch (error) {
        this.logger.warn({ adId, error }, 'Failed to get insights for ad');
      }
    }

    return results;
  }

  async updateAdStatus(adId: string, status: AdStatus): Promise<void> {
    const fbStatus = this.reverseMapStatus(status);
    await this.post(`${adId}`, { status: fbStatus });
  }

  async pauseAd(adId: string): Promise<void> {
    await this.updateAdStatus(adId, 'paused');
  }

  async activateAd(adId: string): Promise<void> {
    await this.updateAdStatus(adId, 'active');
  }

  async updateAdSetBudget(
    adSetId: string,
    dailyBudget: number
  ): Promise<void> {
    await this.post(`${adSetId}`, {
      daily_budget: Math.round(dailyBudget * 100), // Convert to cents
    });
  }

  async updateCampaignBudget(
    campaignId: string,
    dailyBudget: number
  ): Promise<void> {
    await this.post(`${campaignId}`, {
      daily_budget: Math.round(dailyBudget * 100),
    });
  }

  async duplicateAdSet(
    adSetId: string,
    options?: {
      campaignId?: string;
      statusOption?: 'ACTIVE' | 'PAUSED';
      renameOptions?: { pattern: string };
    }
  ): Promise<{ copied_adset_id: string }> {
    const body: Record<string, unknown> = {
      status_option: options?.statusOption ?? 'PAUSED',
    };
    if (options?.campaignId) {
      body.campaign_id = options.campaignId;
    }
    if (options?.renameOptions) {
      body.rename_options = options.renameOptions;
    }
    return this.post(`${adSetId}/copies`, body);
  }

  async createCampaign(params: {
    name: string;
    objective: string;
    status?: string;
    dailyBudget?: number;
    specialAdCategories?: string[];
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: params.name,
      objective: params.objective,
      status: params.status ?? 'PAUSED',
      special_ad_categories: params.specialAdCategories ?? [],
    };
    if (params.dailyBudget) {
      body.daily_budget = Math.round(params.dailyBudget * 100);
    }
    return this.post(`${this.formatAdAccountId()}/campaigns`, body);
  }

  async updateAudience(
    adSetId: string,
    targeting: Record<string, unknown>
  ): Promise<void> {
    await this.post(`${adSetId}`, { targeting });
  }

  async getAudienceInsights(adSetId: string): Promise<Record<string, unknown>> {
    return this.get(`${adSetId}?fields=targeting,reach_estimate`);
  }

  async getAdCreativeInsights(
    adId: string
  ): Promise<{ creative: Record<string, unknown> }> {
    return this.get(
      `${adId}?fields=creative{id,name,title,body,image_url,link_url,call_to_action_type}`
    );
  }

  async createLeadForm(params: {
    name: string;
    questions: Array<{ type: string; key: string; label?: string }>;
    privacyPolicy: { url: string; linkText?: string };
    thankYouPage?: { title: string; body: string };
  }): Promise<{ id: string }> {
    const body = {
      name: params.name,
      questions: params.questions,
      privacy_policy: params.privacyPolicy,
      thank_you_page: params.thankYouPage,
    };
    return this.post(`${this.formatAdAccountId()}/leadgen_forms`, body);
  }

  private mapStatus(fbStatus: string): AdStatus {
    const statusMap: Record<string, AdStatus> = {
      ACTIVE: 'active',
      PAUSED: 'paused',
      DELETED: 'archived',
      ARCHIVED: 'archived',
      PENDING_REVIEW: 'pending_review',
      DISAPPROVED: 'rejected',
      PREAPPROVED: 'pending_review',
      PENDING_BILLING_INFO: 'draft',
      CAMPAIGN_PAUSED: 'paused',
      ADSET_PAUSED: 'paused',
    };
    return statusMap[fbStatus] ?? 'draft';
  }

  private reverseMapStatus(status: AdStatus): string {
    const statusMap: Record<AdStatus, string> = {
      active: 'ACTIVE',
      paused: 'PAUSED',
      archived: 'ARCHIVED',
      draft: 'PAUSED',
      pending_review: 'PAUSED',
      rejected: 'PAUSED',
      completed: 'PAUSED',
    };
    return statusMap[status];
  }

  private mapObjective(
    fbObjective: string
  ): Campaign['objective'] {
    const objectiveMap: Record<string, Campaign['objective']> = {
      BRAND_AWARENESS: 'awareness',
      REACH: 'awareness',
      LINK_CLICKS: 'traffic',
      POST_ENGAGEMENT: 'engagement',
      PAGE_LIKES: 'engagement',
      LEAD_GENERATION: 'leads',
      MESSAGES: 'leads',
      CONVERSIONS: 'sales',
      CATALOG_SALES: 'sales',
      STORE_VISITS: 'sales',
      APP_INSTALLS: 'app_promotion',
    };
    return objectiveMap[fbObjective] ?? 'traffic';
  }

  private parseTargeting(targeting: Record<string, unknown>): AdSet['targeting'] {
    return {
      ageMin: targeting.age_min as number | undefined,
      ageMax: targeting.age_max as number | undefined,
      genders: targeting.genders as ('male' | 'female' | 'all')[] | undefined,
      locations: targeting.geo_locations
        ? Object.values(targeting.geo_locations as Record<string, unknown[]>).flat().map(String)
        : undefined,
      interests: (targeting.interests as Array<{ name: string }> | undefined)?.map(
        (i) => i.name
      ),
      behaviors: (targeting.behaviors as Array<{ name: string }> | undefined)?.map(
        (b) => b.name
      ),
    };
  }
}

export const facebookAds = new FacebookAdsClient();
