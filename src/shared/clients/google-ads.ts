/**
 * GoBoom GTM Agents — Google Ads API Client
 *
 * Handles Google Ads API operations with rate limiting, error handling,
 * and comprehensive campaign analysis capabilities.
 */

import { BaseClient } from './base.client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('google-ads-client');

// Google Ads API configuration
const GOOGLE_ADS_API_VERSION = 'v18';
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId?: string; // MCC account ID if managing multiple accounts
}

export interface Campaign {
  id: string;
  name: string;
  status: 'ENABLED' | 'PAUSED' | 'REMOVED';
  advertisingChannelType: string;
  biddingStrategyType: string;
  budget: {
    amountMicros: string;
    deliveryMethod: string;
  };
  startDate?: string;
  endDate?: string;
}

export interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number; // in currency units (not micros)
  conversions: number;
  conversionValue: number;
  ctr: number;
  cpc: number;
  cpm: number;
  costPerConversion: number;
  conversionRate: number;
  averagePosition?: number;
  searchImpressionShare?: number;
  searchTopImpressionShare?: number;
  qualityScore?: number;
}

export interface AdGroupMetrics {
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  status: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  cpc: number;
}

export interface KeywordMetrics {
  keywordId: string;
  keywordText: string;
  matchType: string;
  adGroupId: string;
  status: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  cpc: number;
  qualityScore?: number;
  expectedCtr?: string;
  adRelevance?: string;
  landingPageExperience?: string;
}

export interface SearchTermReport {
  searchTerm: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  matchType: string;
  addedAsKeyword: boolean;
}

export interface CampaignAnalysis {
  overview: {
    totalSpend: number;
    totalConversions: number;
    averageCPL: number;
    overallCTR: number;
    activeCampaigns: number;
    pausedCampaigns: number;
  };
  campaigns: CampaignMetrics[];
  topPerformers: CampaignMetrics[];
  underperformers: CampaignMetrics[];
  recommendations: Recommendation[];
  issues: Issue[];
}

export interface Recommendation {
  type: 'BUDGET' | 'BIDDING' | 'KEYWORD' | 'AD_COPY' | 'TARGETING' | 'QUALITY_SCORE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  impact: string;
  action: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
}

export interface Issue {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  type: string;
  description: string;
  affectedEntity: string;
  suggestedFix: string;
}

export class GoogleAdsClient extends BaseClient {
  private config: GoogleAdsConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: GoogleAdsConfig) {
    super({ baseUrl: GOOGLE_ADS_BASE_URL }, 'google-ads-client');
    this.config = config;
  }

  // ============================================================
  // Authentication
  // ============================================================

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry > now + 300000) {
      return this.accessToken;
    }

    logger.info('Refreshing Google Ads access token');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh access token: ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = now + (data.expires_in * 1000);

    return this.accessToken!;
  }

  private async makeRequest<T>(
    customerId: string,
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: object
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': this.config.developerToken,
      'Content-Type': 'application/json',
    };

    if (this.config.loginCustomerId) {
      headers['login-customer-id'] = this.config.loginCustomerId.replace(/-/g, '');
    }

    const url = `${GOOGLE_ADS_BASE_URL}/customers/${customerId.replace(/-/g, '')}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      logger.error({ error, url, status: response.status }, 'Google Ads API error');
      throw new Error(`Google Ads API error: ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  // ============================================================
  // GAQL Query Execution
  // ============================================================

  async query<T>(customerId: string, gaqlQuery: string): Promise<T[]> {
    const result = await this.makeRequest<{ results: T[] }>(
      customerId,
      '/googleAds:searchStream',
      'POST',
      { query: gaqlQuery }
    );

    return result.results || [];
  }

  // ============================================================
  // Campaign Operations
  // ============================================================

  async getCampaigns(customerId: string): Promise<Campaign[]> {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign.campaign_budget,
        campaign.start_date,
        campaign.end_date
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `;

    const results = await this.query<any>(customerId, query);

    return results.map(r => ({
      id: r.campaign?.id,
      name: r.campaign?.name,
      status: r.campaign?.status,
      advertisingChannelType: r.campaign?.advertisingChannelType,
      biddingStrategyType: r.campaign?.biddingStrategyType,
      budget: r.campaign?.campaignBudget,
      startDate: r.campaign?.startDate,
      endDate: r.campaign?.endDate,
    }));
  }

  async getCampaignMetrics(
    customerId: string,
    dateRange: { startDate: string; endDate: string }
  ): Promise<CampaignMetrics[]> {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.cost_per_conversion,
        metrics.search_impression_share,
        metrics.search_top_impression_share
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'
      ORDER BY metrics.cost_micros DESC
    `;

    const results = await this.query<any>(customerId, query);

    return results.map(r => ({
      campaignId: r.campaign?.id,
      campaignName: r.campaign?.name,
      impressions: parseInt(r.metrics?.impressions || '0'),
      clicks: parseInt(r.metrics?.clicks || '0'),
      cost: parseInt(r.metrics?.costMicros || '0') / 1000000,
      conversions: parseFloat(r.metrics?.conversions || '0'),
      conversionValue: parseFloat(r.metrics?.conversionsValue || '0'),
      ctr: parseFloat(r.metrics?.ctr || '0'),
      cpc: parseInt(r.metrics?.averageCpc || '0') / 1000000,
      cpm: parseInt(r.metrics?.averageCpm || '0') / 1000000,
      costPerConversion: parseInt(r.metrics?.costPerConversion || '0') / 1000000,
      conversionRate: r.metrics?.clicks > 0
        ? (parseFloat(r.metrics?.conversions || '0') / parseInt(r.metrics?.clicks))
        : 0,
      searchImpressionShare: parseFloat(r.metrics?.searchImpressionShare || '0'),
      searchTopImpressionShare: parseFloat(r.metrics?.searchTopImpressionShare || '0'),
    }));
  }

  async getAdGroupMetrics(
    customerId: string,
    campaignId: string,
    dateRange: { startDate: string; endDate: string }
  ): Promise<AdGroupMetrics[]> {
    const query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.campaign,
        ad_group.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group
      WHERE campaign.id = ${campaignId}
        AND ad_group.status != 'REMOVED'
        AND segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'
      ORDER BY metrics.cost_micros DESC
    `;

    const results = await this.query<any>(customerId, query);

    return results.map(r => ({
      adGroupId: r.adGroup?.id,
      adGroupName: r.adGroup?.name,
      campaignId: r.adGroup?.campaign?.split('/').pop(),
      status: r.adGroup?.status,
      impressions: parseInt(r.metrics?.impressions || '0'),
      clicks: parseInt(r.metrics?.clicks || '0'),
      cost: parseInt(r.metrics?.costMicros || '0') / 1000000,
      conversions: parseFloat(r.metrics?.conversions || '0'),
      ctr: parseFloat(r.metrics?.ctr || '0'),
      cpc: parseInt(r.metrics?.averageCpc || '0') / 1000000,
    }));
  }

  async getKeywordMetrics(
    customerId: string,
    dateRange: { startDate: string; endDate: string },
    campaignId?: string
  ): Promise<KeywordMetrics[]> {
    let whereClause = `
      WHERE keyword_view.resource_name IS NOT NULL
        AND segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'
    `;

    if (campaignId) {
      whereClause += ` AND campaign.id = ${campaignId}`;
    }

    const query = `
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.ad_group,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM keyword_view
      ${whereClause}
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `;

    const results = await this.query<any>(customerId, query);

    return results.map(r => ({
      keywordId: r.adGroupCriterion?.criterionId,
      keywordText: r.adGroupCriterion?.keyword?.text,
      matchType: r.adGroupCriterion?.keyword?.matchType,
      adGroupId: r.adGroupCriterion?.adGroup?.split('/').pop(),
      status: r.adGroupCriterion?.status,
      impressions: parseInt(r.metrics?.impressions || '0'),
      clicks: parseInt(r.metrics?.clicks || '0'),
      cost: parseInt(r.metrics?.costMicros || '0') / 1000000,
      conversions: parseFloat(r.metrics?.conversions || '0'),
      ctr: parseFloat(r.metrics?.ctr || '0'),
      cpc: parseInt(r.metrics?.averageCpc || '0') / 1000000,
      qualityScore: r.adGroupCriterion?.qualityInfo?.qualityScore,
      expectedCtr: r.adGroupCriterion?.qualityInfo?.searchPredictedCtr,
      adRelevance: r.adGroupCriterion?.qualityInfo?.creativeQualityScore,
      landingPageExperience: r.adGroupCriterion?.qualityInfo?.postClickQualityScore,
    }));
  }

  async getSearchTermReport(
    customerId: string,
    dateRange: { startDate: string; endDate: string },
    campaignId?: string
  ): Promise<SearchTermReport[]> {
    let whereClause = `
      WHERE segments.date BETWEEN '${dateRange.startDate}' AND '${dateRange.endDate}'
    `;

    if (campaignId) {
      whereClause += ` AND campaign.id = ${campaignId}`;
    }

    const query = `
      SELECT
        search_term_view.search_term,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        search_term_view.status
      FROM search_term_view
      ${whereClause}
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `;

    const results = await this.query<any>(customerId, query);

    return results.map(r => ({
      searchTerm: r.searchTermView?.searchTerm,
      impressions: parseInt(r.metrics?.impressions || '0'),
      clicks: parseInt(r.metrics?.clicks || '0'),
      cost: parseInt(r.metrics?.costMicros || '0') / 1000000,
      conversions: parseFloat(r.metrics?.conversions || '0'),
      matchType: r.searchTermView?.status,
      addedAsKeyword: r.searchTermView?.status === 'ADDED',
    }));
  }

  // ============================================================
  // Comprehensive Analysis
  // ============================================================

  async analyzeAccount(
    customerId: string,
    dateRange: { startDate: string; endDate: string },
    targetCPL?: number
  ): Promise<CampaignAnalysis> {
    logger.info({ customerId, dateRange }, 'Starting comprehensive account analysis');

    // Get campaign metrics
    const campaignMetrics = await this.getCampaignMetrics(customerId, dateRange);

    // Calculate overview
    const overview = {
      totalSpend: campaignMetrics.reduce((sum, c) => sum + c.cost, 0),
      totalConversions: campaignMetrics.reduce((sum, c) => sum + c.conversions, 0),
      averageCPL: 0,
      overallCTR: 0,
      activeCampaigns: 0,
      pausedCampaigns: 0,
    };

    overview.averageCPL = overview.totalConversions > 0
      ? overview.totalSpend / overview.totalConversions
      : 0;

    const totalClicks = campaignMetrics.reduce((sum, c) => sum + c.clicks, 0);
    const totalImpressions = campaignMetrics.reduce((sum, c) => sum + c.impressions, 0);
    overview.overallCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Identify top performers and underperformers
    const campaignsWithConversions = campaignMetrics.filter(c => c.conversions > 0);
    const sortedByCPL = [...campaignsWithConversions].sort((a, b) => a.costPerConversion - b.costPerConversion);

    const topPerformers = sortedByCPL.slice(0, 3);
    const underperformers = sortedByCPL.slice(-3).reverse();

    // Generate recommendations and issues
    const recommendations: Recommendation[] = [];
    const issues: Issue[] = [];

    // Analyze each campaign
    for (const campaign of campaignMetrics) {
      // Low CTR issue
      if (campaign.ctr < 0.03 && campaign.impressions > 1000) {
        issues.push({
          severity: 'WARNING',
          type: 'LOW_CTR',
          description: `Campaign "${campaign.campaignName}" has CTR of ${(campaign.ctr * 100).toFixed(2)}%`,
          affectedEntity: campaign.campaignName,
          suggestedFix: 'Review ad copy relevance, add negative keywords, check keyword-ad group alignment',
        });
      }

      // High CPL issue
      if (targetCPL && campaign.costPerConversion > targetCPL * 1.5 && campaign.conversions >= 3) {
        issues.push({
          severity: 'CRITICAL',
          type: 'HIGH_CPL',
          description: `Campaign "${campaign.campaignName}" has CPL of $${campaign.costPerConversion.toFixed(2)} (target: $${targetCPL})`,
          affectedEntity: campaign.campaignName,
          suggestedFix: 'Consider pausing or reducing budget, review keyword performance',
        });

        recommendations.push({
          type: 'BUDGET',
          priority: 'HIGH',
          description: `Reduce budget for "${campaign.campaignName}"`,
          impact: `Potential savings of $${(campaign.cost * 0.3).toFixed(2)} per period`,
          action: `Reduce daily budget by 30% or pause low-performing ad groups`,
          campaignId: campaign.campaignId,
        });
      }

      // Good performer - recommend budget increase
      if (targetCPL && campaign.costPerConversion < targetCPL * 0.7 && campaign.conversions >= 5) {
        recommendations.push({
          type: 'BUDGET',
          priority: 'MEDIUM',
          description: `Increase budget for high-performer "${campaign.campaignName}"`,
          impact: `CPL is ${((1 - campaign.costPerConversion / targetCPL) * 100).toFixed(0)}% below target`,
          action: `Consider increasing budget by 20-30% to capture more conversions`,
          campaignId: campaign.campaignId,
        });
      }

      // Low impression share
      if (campaign.searchImpressionShare && campaign.searchImpressionShare < 0.5 && campaign.conversions >= 2) {
        recommendations.push({
          type: 'BUDGET',
          priority: 'MEDIUM',
          description: `Low impression share for "${campaign.campaignName}"`,
          impact: `Only capturing ${(campaign.searchImpressionShare * 100).toFixed(0)}% of available impressions`,
          action: `Increase budget or bids to capture lost impression share`,
          campaignId: campaign.campaignId,
        });
      }
    }

    // No conversions at all
    if (overview.totalConversions === 0 && overview.totalSpend > 100) {
      issues.push({
        severity: 'CRITICAL',
        type: 'NO_CONVERSIONS',
        description: `Account has spent $${overview.totalSpend.toFixed(2)} with zero conversions`,
        affectedEntity: 'Account',
        suggestedFix: 'Check conversion tracking setup, review landing pages, audit keyword relevance',
      });
    }

    logger.info({
      totalCampaigns: campaignMetrics.length,
      totalSpend: overview.totalSpend,
      totalConversions: overview.totalConversions,
      recommendationsCount: recommendations.length,
      issuesCount: issues.length,
    }, 'Analysis complete');

    return {
      overview,
      campaigns: campaignMetrics,
      topPerformers,
      underperformers,
      recommendations,
      issues,
    };
  }

  // ============================================================
  // Mutation Operations
  // ============================================================

  async pauseCampaign(customerId: string, campaignId: string): Promise<void> {
    const operation = {
      operations: [{
        update: {
          resourceName: `customers/${customerId.replace(/-/g, '')}/campaigns/${campaignId}`,
          status: 'PAUSED',
        },
        updateMask: 'status',
      }],
    };

    await this.makeRequest(customerId, '/campaigns:mutate', 'POST', operation);
    logger.info({ customerId, campaignId }, 'Campaign paused');
  }

  async enableCampaign(customerId: string, campaignId: string): Promise<void> {
    const operation = {
      operations: [{
        update: {
          resourceName: `customers/${customerId.replace(/-/g, '')}/campaigns/${campaignId}`,
          status: 'ENABLED',
        },
        updateMask: 'status',
      }],
    };

    await this.makeRequest(customerId, '/campaigns:mutate', 'POST', operation);
    logger.info({ customerId, campaignId }, 'Campaign enabled');
  }

  async updateCampaignBudget(
    customerId: string,
    campaignId: string,
    newBudgetMicros: number
  ): Promise<void> {
    // First, get the campaign's budget resource name
    const query = `
      SELECT campaign.campaign_budget
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `;

    const results = await this.query<any>(customerId, query);
    if (!results.length || !results[0].campaign?.campaignBudget) {
      throw new Error(`Campaign ${campaignId} not found or has no budget`);
    }

    const budgetResourceName = results[0].campaign.campaignBudget;

    const operation = {
      operations: [{
        update: {
          resourceName: budgetResourceName,
          amountMicros: newBudgetMicros.toString(),
        },
        updateMask: 'amount_micros',
      }],
    };

    await this.makeRequest(customerId, '/campaignBudgets:mutate', 'POST', operation);
    logger.info({ customerId, campaignId, newBudgetMicros }, 'Campaign budget updated');
  }

  async addNegativeKeyword(
    customerId: string,
    campaignId: string,
    keyword: string
  ): Promise<void> {
    const operation = {
      operations: [{
        create: {
          campaign: `customers/${customerId.replace(/-/g, '')}/campaigns/${campaignId}`,
          negative: true,
          keyword: {
            text: keyword,
            matchType: 'PHRASE',
          },
        },
      }],
    };

    await this.makeRequest(customerId, '/campaignCriteria:mutate', 'POST', operation);
    logger.info({ customerId, campaignId, keyword }, 'Negative keyword added');
  }
}

export function createGoogleAdsClient(): GoogleAdsClient {
  // Load credentials from environment or file
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let credentials: any = {};

  if (credentialsPath) {
    try {
      const fs = require('fs');
      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    } catch (e) {
      logger.warn({ credentialsPath }, 'Failed to load Google Ads credentials from file');
    }
  }

  return new GoogleAdsClient({
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    clientId: credentials.client_id || process.env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: credentials.client_secret || process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    refreshToken: credentials.refresh_token || process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  });
}
