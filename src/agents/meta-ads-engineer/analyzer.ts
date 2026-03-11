import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../../shared/utils/logger.js';
import { FacebookAdsClient } from '../../shared/clients/facebook-ads.js';
import { ClientRecord } from '../../shared/clients/supabase.js';
import { getBenchmark, getCplStatus, PracticeAreaBenchmark } from './benchmarks.js';
import {
  CampaignAnalysis,
  AdSetAnalysis,
  AdAnalysis,
  FullAnalysisResult,
  AnalysisSummary,
  ProposedAction,
} from './types.js';
import { evaluateAdRules, evaluateAdSetRules, evaluateCampaignRules } from './rules.js';
import {
  identifyScalingCandidates,
  generateScalingActions,
  detectCreativeFatigue,
  detectAudienceOverlap,
} from './strategies.js';

const logger = createLogger('meta-analyzer');

export class MetaAdsAnalyzer {
  private anthropic: Anthropic | null = null;

  private getAnthropic(): Anthropic {
    if (!this.anthropic) {
      this.anthropic = new Anthropic();
    }
    return this.anthropic;
  }

  async analyzeClient(client: ClientRecord): Promise<FullAnalysisResult> {
    logger.info({ clientId: client.id, clientName: client.name }, 'Starting Meta ads analysis');

    const fbClient = new FacebookAdsClient(
      client.meta_access_token,
      client.meta_ad_account_id
    );

    const benchmark = getBenchmark(client.practice_area);
    const targetCpl = client.target_cpl ?? benchmark.targetCpl;

    // Fetch all data
    const campaigns = await fbClient.getCampaigns();
    const activeCampaigns = campaigns.filter((c) => c.status === 'active');

    const campaignAnalyses: CampaignAnalysis[] = [];

    for (const campaign of activeCampaigns) {
      const analysis = await this.analyzeCampaign(fbClient, campaign, benchmark, targetCpl);
      campaignAnalyses.push(analysis);
    }

    // Collect all proposed actions from rules
    const allActions: ProposedAction[] = [];

    for (const campaign of campaignAnalyses) {
      allActions.push(...evaluateCampaignRules(campaign, benchmark, targetCpl));

      for (const adSet of campaign.adSets) {
        allActions.push(...evaluateAdSetRules(adSet, campaign, benchmark, targetCpl));

        for (const ad of adSet.ads) {
          allActions.push(...evaluateAdRules(ad, adSet, benchmark, targetCpl));
        }
      }
    }

    // Strategy-level analysis
    const result: FullAnalysisResult = {
      clientId: client.id,
      clientName: client.name,
      practiceArea: client.practice_area,
      targetCpl,
      timestamp: new Date().toISOString(),
      campaigns: campaignAnalyses,
      proposedActions: allActions,
      summary: this.calculateSummary(campaignAnalyses, allActions),
    };

    // Scaling candidates
    const scalingCandidates = identifyScalingCandidates(result, benchmark);
    if (scalingCandidates.length > 0) {
      const scalingActions = generateScalingActions(scalingCandidates);
      result.proposedActions.push(...scalingActions);
    }

    // Creative fatigue detection
    const fatigueActions = detectCreativeFatigue(result);
    result.proposedActions.push(...fatigueActions);

    // Audience overlap detection
    const overlapActions = detectAudienceOverlap(result);
    result.proposedActions.push(...overlapActions);

    // Recalculate summary with all actions
    result.summary = this.calculateSummary(campaignAnalyses, result.proposedActions);

    // Claude analysis for strategic insights (if API key available)
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        result.claudeInsights = await this.getClaudeInsights(result, benchmark);
      } catch (error) {
        logger.warn({ error }, 'Claude analysis failed — continuing without insights');
      }
    }

    logger.info(
      {
        clientName: client.name,
        campaigns: campaignAnalyses.length,
        actions: result.proposedActions.length,
      },
      'Meta ads analysis complete'
    );

    return result;
  }

  private async analyzeCampaign(
    fbClient: FacebookAdsClient,
    campaign: any,
    benchmark: PracticeAreaBenchmark,
    targetCpl: number
  ): Promise<CampaignAnalysis> {
    const adSets = await fbClient.getAdSets(campaign.id);
    const activeAdSets = adSets.filter((as) => as.status === 'active');

    const adSetAnalyses: AdSetAnalysis[] = [];

    for (const adSet of activeAdSets) {
      const analysis = await this.analyzeAdSet(fbClient, adSet, campaign.id, benchmark, targetCpl);
      adSetAnalyses.push(analysis);
    }

    const totalSpend = adSetAnalyses.reduce((sum, as) => sum + as.spend, 0);
    const totalLeads = adSetAnalyses.reduce((sum, as) => sum + as.leads, 0);
    const totalImpressions = adSetAnalyses.reduce((sum, as) => sum + as.impressions, 0);
    const totalClicks = adSetAnalyses.reduce((sum, as) => sum + (as.ctr / 100 * as.impressions), 0);
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const budget = campaign.dailyBudget ?? 0;

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      spend: totalSpend,
      budget,
      leads: totalLeads,
      cpl,
      ctr,
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      frequency: adSetAnalyses.length > 0
        ? adSetAnalyses.reduce((sum, as) => sum + as.frequency, 0) / adSetAnalyses.length
        : 0,
      impressions: totalImpressions,
      clicks: totalClicks,
      reach: 0,
      spendPacing: budget > 0 ? (totalSpend / (budget * 7)) * 100 : 0,
      projectedMonthlySpend: (totalSpend / 7) * 30,
      healthStatus: this.determineHealth(cpl, ctr, targetCpl, benchmark),
      issues: [],
      adSets: adSetAnalyses,
    };
  }

  private async analyzeAdSet(
    fbClient: FacebookAdsClient,
    adSet: any,
    campaignId: string,
    benchmark: PracticeAreaBenchmark,
    targetCpl: number
  ): Promise<AdSetAnalysis> {
    const ads = await fbClient.getAds(adSet.id);
    const activeAds = ads.filter((a) => a.status === 'active');

    const adAnalyses: AdAnalysis[] = [];
    let totalSpend = 0;
    let totalLeads = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let avgFrequency = 0;

    if (activeAds.length > 0) {
      const adIds = activeAds.map((a) => a.id);
      const insights = await fbClient.getAdInsights(adIds, 'last_7d');
      const insightMap = new Map(insights.map((i) => [i.adId, i]));

      for (const ad of activeAds) {
        const insight = insightMap.get(ad.id);
        const adAnalysis = this.analyzeAd(ad, insight, targetCpl);
        adAnalyses.push(adAnalysis);

        totalSpend += adAnalysis.spend;
        totalLeads += adAnalysis.leads;
        totalImpressions += adAnalysis.impressions;
        totalClicks += adAnalysis.clicks;
        avgFrequency += adAnalysis.frequency;
      }

      if (adAnalyses.length > 0) {
        avgFrequency /= adAnalyses.length;
      }
    }

    const budget = adSet.dailyBudget ?? 0;
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    return {
      adSetId: adSet.id,
      adSetName: adSet.name,
      campaignId,
      status: adSet.status,
      spend: totalSpend,
      budget,
      leads: totalLeads,
      cpl,
      ctr,
      frequency: avgFrequency,
      impressions: totalImpressions,
      saturationScore: this.calculateSaturationScore(avgFrequency, ctr, benchmark),
      healthStatus: this.determineHealth(cpl, ctr, targetCpl, benchmark),
      issues: [],
      ads: adAnalyses,
    };
  }

  private analyzeAd(ad: any, insight: any, targetCpl: number): AdAnalysis {
    const spend = insight?.spend ?? 0;
    const impressions = insight?.impressions ?? 0;
    const clicks = insight?.clicks ?? 0;
    const ctr = insight?.ctr ?? 0;
    const cpm = insight?.cpm ?? 0;
    const cpc = insight?.cpc ?? 0;
    const frequency = insight?.frequency ?? 0;
    const leads = insight?.conversions ?? insight?.actions?.lead ?? 0;
    const cpl = leads > 0 ? spend / leads : 0;

    const fatigueScore = this.calculateFatigueScore(frequency, ctr, impressions);
    const classification = this.classifyAd(cpl, targetCpl, leads, impressions, fatigueScore);

    return {
      adId: ad.id,
      adName: ad.name,
      adSetId: ad.adSetId,
      status: ad.status,
      spend,
      impressions,
      clicks,
      ctr,
      cpm,
      cpc,
      leads,
      cpl,
      frequency,
      classification,
      fatigueScore,
      issues: [],
    };
  }

  private calculateFatigueScore(frequency: number, ctr: number, impressions: number): number {
    if (impressions < 500) return 0; // Too early to tell

    let score = 0;

    // High frequency contributes to fatigue
    if (frequency > 5) score += 40;
    else if (frequency > 3) score += 25;
    else if (frequency > 2) score += 10;

    // Low CTR indicates audience isn't engaging
    if (ctr < 0.5) score += 30;
    else if (ctr < 1.0) score += 15;

    // High impressions with low engagement
    if (impressions > 10000 && ctr < 1.0) score += 20;

    return Math.min(score, 100);
  }

  private calculateSaturationScore(frequency: number, ctr: number, benchmark: PracticeAreaBenchmark): number {
    let score = 0;

    if (frequency > 4) score += 40;
    else if (frequency > 3) score += 25;
    else if (frequency > 2) score += 15;

    if (ctr < benchmark.expectedCtr * 0.5) score += 30;
    else if (ctr < benchmark.expectedCtr * 0.75) score += 15;

    // High frequency + declining CTR = saturation
    if (frequency > 2.5 && ctr < benchmark.expectedCtr) score += 20;

    return Math.min(score, 100);
  }

  private classifyAd(
    cpl: number,
    targetCpl: number,
    leads: number,
    impressions: number,
    fatigueScore: number
  ): AdAnalysis['classification'] {
    if (fatigueScore > 70) return 'fatigued';
    if (impressions < 500) return 'new';
    if (leads < 2) return 'testing';
    if (cpl > 0 && cpl < targetCpl * 0.8) return 'winner';
    if (cpl > targetCpl * 1.5) return 'loser';
    return 'testing';
  }

  private determineHealth(
    cpl: number,
    ctr: number,
    targetCpl: number,
    benchmark: PracticeAreaBenchmark
  ): 'healthy' | 'warning' | 'critical' | 'learning' {
    if (cpl === 0) return 'learning';
    const cplStatus = getCplStatus(cpl, { ...benchmark, targetCpl });
    if (cplStatus === 'critical') return 'critical';
    if (cplStatus === 'warning' || ctr < benchmark.expectedCtr * 0.5) return 'warning';
    return 'healthy';
  }

  private calculateSummary(
    campaigns: CampaignAnalysis[],
    actions: ProposedAction[]
  ): AnalysisSummary {
    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    const totalLeads = campaigns.reduce((sum, c) => sum + c.leads, 0);
    const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);

    let winnersCount = 0;
    let losersCount = 0;
    let fatiguedAdsCount = 0;

    for (const campaign of campaigns) {
      for (const adSet of campaign.adSets) {
        for (const ad of adSet.ads) {
          if (ad.classification === 'winner') winnersCount++;
          if (ad.classification === 'loser') losersCount++;
          if (ad.classification === 'fatigued') fatiguedAdsCount++;
        }
      }
    }

    return {
      totalSpend,
      totalLeads,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
      avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      healthyCampaigns: campaigns.filter((c) => c.healthStatus === 'healthy').length,
      warningCampaigns: campaigns.filter((c) => c.healthStatus === 'warning').length,
      criticalCampaigns: campaigns.filter((c) => c.healthStatus === 'critical').length,
      winnersCount,
      losersCount,
      fatiguedAdsCount,
      proposedActionsCount: actions.length,
      autoExecuteCount: actions.filter((a) => a.auto_execute).length,
      needsApprovalCount: actions.filter((a) => !a.auto_execute).length,
    };
  }

  private async getClaudeInsights(
    result: FullAnalysisResult,
    benchmark: PracticeAreaBenchmark
  ): Promise<string> {
    const prompt = `You are a veteran Meta Ads media buyer analyzing a law firm's ad account. Provide strategic insights.

Client: ${result.clientName}
Practice Area: ${result.practiceArea ?? 'General'}
Target CPL: $${result.targetCpl}
Benchmark CPL: $${benchmark.targetCpl} (warning: $${benchmark.warningCpl}, critical: $${benchmark.criticalCpl})

Performance Summary:
- Total Spend (7d): $${result.summary.totalSpend.toFixed(2)}
- Total Leads: ${result.summary.totalLeads}
- Average CPL: $${result.summary.avgCpl.toFixed(2)}
- Average CTR: ${result.summary.avgCtr.toFixed(2)}%
- Campaigns: ${result.campaigns.length} (${result.summary.healthyCampaigns} healthy, ${result.summary.warningCampaigns} warning, ${result.summary.criticalCampaigns} critical)
- Winners: ${result.summary.winnersCount}, Losers: ${result.summary.losersCount}, Fatigued: ${result.summary.fatiguedAdsCount}

Campaigns:
${result.campaigns.map((c) =>
  `- ${c.campaignName}: $${c.spend.toFixed(2)} spend, ${c.leads} leads, $${c.cpl > 0 ? c.cpl.toFixed(2) : 'N/A'} CPL, ${c.ctr.toFixed(2)}% CTR [${c.healthStatus}]`
).join('\n')}

Proposed Actions (${result.proposedActions.length}):
${result.proposedActions.slice(0, 10).map((a) =>
  `- ${a.action_type}: ${a.description} (${a.auto_execute ? 'auto' : 'needs approval'})`
).join('\n')}

Provide 3-5 strategic insights about:
1. What's working and why
2. What needs attention and specific recommendations
3. Scaling opportunities
4. Any patterns a human media buyer should investigate

Be specific, data-driven, and concise. Focus on actionable insights.`;

    const response = await this.getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.text ?? '';
  }
}
