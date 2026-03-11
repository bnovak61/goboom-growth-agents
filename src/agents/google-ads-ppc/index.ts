/**
 * GoBoom Google Ads PPC Agent
 *
 * Autonomous agent that operates like a veteran PPC engineer:
 * - Analyzes campaign performance with expert-level insight
 * - Identifies issues and opportunities
 * - Executes fixes with proper safety rails
 * - Focuses on lead quality, not just volume
 */

import { GoogleAdsApi, enums } from 'google-ads-api';
import * as fs from 'fs';

// Configuration
const DEVELOPER_TOKEN = 'wyv5YWkns7LYXHjsZ5bokg';
const LOGIN_CUSTOMER_ID = '5660386900'; // MCC Account

// Load OAuth credentials
const credentials = JSON.parse(
  fs.readFileSync('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json', 'utf-8')
);

interface CampaignData {
  id: string;
  name: string;
  status: string;
  type: string;
  budget: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpl: number;
  impressionShare?: number;
  qualityScore?: number;
}

interface SearchTermData {
  term: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  matchType: string;
  isNegative: boolean;
}

interface KeywordData {
  id: string;
  text: string;
  matchType: string;
  status: string;
  adGroupId: string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  qualityScore?: number;
  expectedCtr?: string;
  adRelevance?: string;
  landingPageExp?: string;
}

interface AnalysisResult {
  summary: {
    totalSpend: number;
    totalConversions: number;
    avgCPL: number;
    totalClicks: number;
    avgCTR: number;
  };
  campaigns: CampaignData[];
  topKeywords: KeywordData[];
  wastedSpend: SearchTermData[];
  issues: Issue[];
  recommendations: Recommendation[];
  actionsToExecute: Action[];
}

interface Issue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  type: string;
  description: string;
  entity: string;
  metric?: string;
  impact?: string;
}

interface Recommendation {
  priority: number;
  type: string;
  action: string;
  reason: string;
  expectedImpact: string;
  autoExecute: boolean;
}

interface Action {
  type: 'PAUSE_CAMPAIGN' | 'PAUSE_ADGROUP' | 'PAUSE_KEYWORD' | 'ADD_NEGATIVE' | 'ADJUST_BID' | 'ADJUST_BUDGET';
  entityType: string;
  entityId: string;
  entityName: string;
  currentValue?: string;
  newValue?: string;
  reason: string;
  executed: boolean;
  result?: string;
}

export class GoogleAdsPPCAgent {
  private client: GoogleAdsApi;
  private customerId: string;
  private targetCPL: number;
  private dryRun: boolean;

  constructor(config: {
    customerId: string;
    targetCPL: number;
    dryRun?: boolean;
  }) {
    this.customerId = config.customerId.replace(/-/g, '');
    this.targetCPL = config.targetCPL;
    this.dryRun = config.dryRun ?? true;

    this.client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: DEVELOPER_TOKEN,
    });
  }

  private async getCustomer() {
    return this.client.Customer({
      customer_id: this.customerId,
      login_customer_id: LOGIN_CUSTOMER_ID,
      refresh_token: credentials.refresh_token,
    });
  }

  async analyze(): Promise<AnalysisResult> {
    console.log('═'.repeat(65));
    console.log('  GOOGLE ADS PPC ANALYSIS');
    console.log(`  Customer ID: ${this.customerId}`);
    console.log(`  Target CPL: $${this.targetCPL}`);
    console.log('═'.repeat(65));
    console.log('');

    const customer = await this.getCustomer();

    // Get campaign data
    console.log('📊 Fetching campaign data...');
    const campaigns = await this.getCampaignMetrics(customer);

    // Get keyword data
    console.log('🔑 Fetching keyword data...');
    const keywords = await this.getKeywordMetrics(customer);

    // Get search terms (wasted spend analysis)
    console.log('🔍 Analyzing search terms...');
    const searchTerms = await this.getSearchTerms(customer);

    // Calculate summary
    const summary = this.calculateSummary(campaigns);

    // Analyze and generate insights
    console.log('🧠 Generating expert analysis...');
    const issues = this.identifyIssues(campaigns, keywords, searchTerms);
    const recommendations = this.generateRecommendations(campaigns, keywords, searchTerms, issues);
    const actionsToExecute = this.determineActions(recommendations);

    // Find wasted spend (high cost, no conversions)
    const wastedSpend = searchTerms
      .filter(t => t.cost > 10 && t.conversions === 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 20);

    const result: AnalysisResult = {
      summary,
      campaigns,
      topKeywords: keywords.slice(0, 20),
      wastedSpend,
      issues,
      recommendations,
      actionsToExecute,
    };

    // Execute actions if not dry run
    if (!this.dryRun && actionsToExecute.length > 0) {
      console.log('');
      console.log('⚡ Executing approved actions...');
      await this.executeActions(customer, actionsToExecute);
    }

    return result;
  }

  private async getCampaignMetrics(customer: any): Promise<CampaignData[]> {
    try {
      // Only get ACTIVE SEARCH campaigns (skip paused/archived)
      const campaigns = await customer.query(`
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign_budget.amount_micros,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.ctr,
          metrics.average_cpc,
          metrics.search_impression_share
        FROM campaign
        WHERE segments.date DURING LAST_30_DAYS
          AND campaign.status = 'ENABLED'
          AND campaign.advertising_channel_type = 'SEARCH'
        ORDER BY metrics.cost_micros DESC
      `);

      return campaigns.map((row: any) => ({
        id: row.campaign?.id?.toString() || '',
        name: row.campaign?.name || '',
        status: row.campaign?.status || '',
        type: row.campaign?.advertising_channel_type || '',
        budget: (row.campaign_budget?.amount_micros || 0) / 1_000_000,
        spend: (row.metrics?.cost_micros || 0) / 1_000_000,
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        conversions: row.metrics?.conversions || 0,
        ctr: (row.metrics?.ctr || 0) * 100,
        cpc: (row.metrics?.average_cpc || 0) / 1_000_000,
        cpl: row.metrics?.conversions > 0
          ? (row.metrics?.cost_micros || 0) / 1_000_000 / row.metrics.conversions
          : Infinity,
        impressionShare: row.metrics?.search_impression_share || 0,
      }));
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      return [];
    }
  }

  private async getKeywordMetrics(customer: any): Promise<KeywordData[]> {
    try {
      const keywords = await customer.query(`
        SELECT
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          ad_group.id,
          ad_group.name,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          ad_group_criterion.quality_info.quality_score
        FROM keyword_view
        WHERE segments.date DURING LAST_30_DAYS
          AND ad_group_criterion.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 100
      `);

      return keywords.map((row: any) => ({
        id: row.ad_group_criterion?.criterion_id?.toString() || '',
        text: row.ad_group_criterion?.keyword?.text || '',
        matchType: row.ad_group_criterion?.keyword?.match_type || '',
        status: row.ad_group_criterion?.status || '',
        adGroupId: row.ad_group?.id?.toString() || '',
        adGroupName: row.ad_group?.name || '',
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: (row.metrics?.cost_micros || 0) / 1_000_000,
        conversions: row.metrics?.conversions || 0,
        qualityScore: row.ad_group_criterion?.quality_info?.quality_score,
      }));
    } catch (error) {
      console.error('Error fetching keywords:', error);
      return [];
    }
  }

  private async getSearchTerms(customer: any): Promise<SearchTermData[]> {
    try {
      const terms = await customer.query(`
        SELECT
          search_term_view.search_term,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          search_term_view.status
        FROM search_term_view
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
        LIMIT 500
      `);

      return terms.map((row: any) => ({
        term: row.search_term_view?.search_term || '',
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: (row.metrics?.cost_micros || 0) / 1_000_000,
        conversions: row.metrics?.conversions || 0,
        matchType: row.search_term_view?.status || '',
        isNegative: false,
      }));
    } catch (error) {
      console.error('Error fetching search terms:', error);
      return [];
    }
  }

  private calculateSummary(campaigns: CampaignData[]) {
    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);

    return {
      totalSpend,
      totalConversions,
      avgCPL: totalConversions > 0 ? totalSpend / totalConversions : 0,
      totalClicks,
      avgCTR: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    };
  }

  private identifyIssues(
    campaigns: CampaignData[],
    keywords: KeywordData[],
    searchTerms: SearchTermData[]
  ): Issue[] {
    const issues: Issue[] = [];

    // Campaign-level issues
    for (const campaign of campaigns) {
      // High CPL campaigns
      if (campaign.cpl > this.targetCPL * 1.5 && campaign.conversions >= 3) {
        issues.push({
          severity: 'CRITICAL',
          type: 'HIGH_CPL',
          description: `CPL of $${campaign.cpl.toFixed(2)} is ${Math.round((campaign.cpl / this.targetCPL - 1) * 100)}% above target`,
          entity: campaign.name,
          metric: `$${campaign.cpl.toFixed(2)} vs $${this.targetCPL} target`,
          impact: `Overspending ~$${((campaign.cpl - this.targetCPL) * campaign.conversions).toFixed(2)} on this campaign`,
        });
      }

      // Low CTR (indicates poor ad relevance or wrong audience)
      if (campaign.ctr < 2 && campaign.impressions > 1000) {
        issues.push({
          severity: 'HIGH',
          type: 'LOW_CTR',
          description: `CTR of ${campaign.ctr.toFixed(2)}% indicates poor ad relevance or targeting`,
          entity: campaign.name,
          metric: `${campaign.ctr.toFixed(2)}% CTR`,
          impact: 'Low CTR leads to higher CPCs and poor quality score',
        });
      }

      // Low impression share (missing opportunities)
      if (campaign.impressionShare && campaign.impressionShare < 0.5 && campaign.conversions > 0) {
        issues.push({
          severity: 'MEDIUM',
          type: 'LOW_IMPRESSION_SHARE',
          description: `Only capturing ${(campaign.impressionShare * 100).toFixed(0)}% of available impressions`,
          entity: campaign.name,
          impact: 'Missing potential leads due to budget or bid constraints',
        });
      }

      // Zero conversions with significant spend
      if (campaign.conversions === 0 && campaign.spend > 100) {
        issues.push({
          severity: 'CRITICAL',
          type: 'ZERO_CONVERSIONS',
          description: `Spent $${campaign.spend.toFixed(2)} with no conversions`,
          entity: campaign.name,
          impact: 'Complete waste of budget - check conversion tracking or pause',
        });
      }
    }

    // Keyword-level issues
    for (const keyword of keywords) {
      // Low quality score
      if (keyword.qualityScore && keyword.qualityScore < 5 && keyword.cost > 50) {
        issues.push({
          severity: 'HIGH',
          type: 'LOW_QUALITY_SCORE',
          description: `Quality Score of ${keyword.qualityScore}/10 is hurting performance`,
          entity: `"${keyword.text}" in ${keyword.adGroupName}`,
          impact: 'Paying 50-400% more per click than competitors',
        });
      }

      // High spend, no conversions keyword
      if (keyword.conversions === 0 && keyword.cost > 50) {
        issues.push({
          severity: 'HIGH',
          type: 'KEYWORD_NO_CONVERSIONS',
          description: `Spent $${keyword.cost.toFixed(2)} with zero conversions`,
          entity: `"${keyword.text}"`,
          impact: 'Direct budget waste - consider pausing or negative matching',
        });
      }
    }

    // Search term issues (informational queries)
    const informationalTerms = searchTerms.filter(t =>
      /\b(what is|how to|how do|can i|should i|is it|why|when|where|who|which|definition|meaning|example|tutorial|guide|free|diy)\b/i.test(t.term)
      && t.cost > 5
    );

    if (informationalTerms.length > 0) {
      const totalWaste = informationalTerms.reduce((sum, t) => sum + t.cost, 0);
      issues.push({
        severity: 'CRITICAL',
        type: 'INFORMATIONAL_QUERIES',
        description: `${informationalTerms.length} informational search terms wasting budget`,
        entity: 'Search Terms',
        metric: `$${totalWaste.toFixed(2)} on non-intent queries`,
        impact: 'These searchers want information, not legal services',
      });
    }

    return issues.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  private generateRecommendations(
    campaigns: CampaignData[],
    keywords: KeywordData[],
    searchTerms: SearchTermData[],
    issues: Issue[]
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];
    let priority = 1;

    // Address informational queries first
    const informationalTerms = searchTerms.filter(t =>
      /\b(what is|how to|how do|can i|should i|is it|why|when|where|who|which|definition|meaning|example|tutorial|guide|free|diy)\b/i.test(t.term)
      && t.cost > 5
    );

    if (informationalTerms.length > 0) {
      recommendations.push({
        priority: priority++,
        type: 'ADD_NEGATIVES',
        action: 'Add negative keywords for informational queries',
        reason: `${informationalTerms.length} search terms show informational intent, not buying intent`,
        expectedImpact: `Save $${informationalTerms.reduce((s, t) => s + t.cost, 0).toFixed(2)}/month and improve lead quality`,
        autoExecute: true,
      });
    }

    // Pause zero-conversion campaigns with spend
    const zeroCampaigns = campaigns.filter(c => c.conversions === 0 && c.spend > 100);
    for (const campaign of zeroCampaigns) {
      recommendations.push({
        priority: priority++,
        type: 'PAUSE_CAMPAIGN',
        action: `Pause campaign: ${campaign.name}`,
        reason: 'Zero conversions with significant spend indicates fundamental issue',
        expectedImpact: `Save $${campaign.spend.toFixed(2)} until issues are diagnosed`,
        autoExecute: false, // Pausing campaigns needs approval
      });
    }

    // Tighten match types for broad match keywords
    const broadKeywords = keywords.filter(k =>
      k.matchType === 'BROAD' && k.cost > 50 && k.conversions < 2
    );
    if (broadKeywords.length > 0) {
      recommendations.push({
        priority: priority++,
        type: 'TIGHTEN_MATCH_TYPES',
        action: 'Convert broad match keywords to phrase/exact match',
        reason: 'Broad match is triggering irrelevant searches',
        expectedImpact: 'Reduce wasted spend and improve lead quality',
        autoExecute: false,
      });
    }

    // Budget reallocation from poor to good performers
    const goodCampaigns = campaigns.filter(c => c.cpl < this.targetCPL && c.conversions >= 5);
    const badCampaigns = campaigns.filter(c => c.cpl > this.targetCPL * 1.5 && c.conversions >= 3);

    if (goodCampaigns.length > 0 && badCampaigns.length > 0) {
      recommendations.push({
        priority: priority++,
        type: 'REALLOCATE_BUDGET',
        action: 'Shift budget from underperformers to top performers',
        reason: `Top performers have CPL of $${goodCampaigns[0].cpl.toFixed(2)} vs $${badCampaigns[0].cpl.toFixed(2)} for worst`,
        expectedImpact: 'Reduce overall CPL by 15-25% with same budget',
        autoExecute: false,
      });
    }

    return recommendations;
  }

  private determineActions(recommendations: Recommendation[]): Action[] {
    const actions: Action[] = [];

    // For now, we focus on safe, high-impact actions
    for (const rec of recommendations) {
      if (rec.type === 'ADD_NEGATIVES' && rec.autoExecute) {
        // Add standard negative keywords for informational queries
        const negatives = [
          'what is', 'how to', 'how do', 'can i', 'should i',
          'free', 'diy', 'pro bono', 'cheap', 'definition',
          'meaning', 'example', 'tutorial', 'guide', 'reddit',
          'jobs', 'salary', 'career', 'hiring', 'school', 'degree'
        ];

        for (const negative of negatives) {
          actions.push({
            type: 'ADD_NEGATIVE',
            entityType: 'campaign',
            entityId: 'account-level',
            entityName: negative,
            reason: 'Blocks informational/non-intent searches',
            executed: false,
          });
        }
      }
    }

    return actions;
  }

  private async executeActions(customer: any, actions: Action[]): Promise<void> {
    for (const action of actions) {
      try {
        if (action.type === 'ADD_NEGATIVE') {
          // Would execute: customer.campaignCriterion.create(...)
          console.log(`  ✓ Would add negative: "${action.entityName}"`);
          action.executed = true;
          action.result = 'Simulated (dry run)';
        }
      } catch (error) {
        console.error(`  ✗ Failed: ${action.entityName}`, error);
        action.result = `Error: ${error}`;
      }
    }
  }

  generateReport(result: AnalysisResult): string {
    const lines: string[] = [];

    lines.push('═'.repeat(65));
    lines.push('  GOOGLE ADS PPC ANALYSIS REPORT');
    lines.push('═'.repeat(65));
    lines.push('');

    // Summary
    lines.push('📊 PERFORMANCE SUMMARY (Last 30 Days)');
    lines.push('─'.repeat(65));
    lines.push(`  Total Spend:       $${result.summary.totalSpend.toFixed(2)}`);
    lines.push(`  Total Conversions: ${result.summary.totalConversions}`);
    lines.push(`  Average CPL:       $${result.summary.avgCPL.toFixed(2)} (target: $${this.targetCPL})`);
    lines.push(`  Total Clicks:      ${result.summary.totalClicks}`);
    lines.push(`  Average CTR:       ${result.summary.avgCTR.toFixed(2)}%`);
    lines.push('');

    // Campaigns
    if (result.campaigns.length > 0) {
      lines.push('📈 CAMPAIGNS');
      lines.push('─'.repeat(65));
      for (const c of result.campaigns.slice(0, 10)) {
        const cplStatus = c.cpl <= this.targetCPL ? '✓' : c.cpl <= this.targetCPL * 1.5 ? '⚠' : '✗';
        lines.push(`  ${cplStatus} ${c.name}`);
        lines.push(`    Spend: $${c.spend.toFixed(2)} | Conv: ${c.conversions} | CPL: $${c.cpl === Infinity ? '∞' : c.cpl.toFixed(2)} | CTR: ${c.ctr.toFixed(2)}%`);
      }
      lines.push('');
    }

    // Issues
    if (result.issues.length > 0) {
      lines.push('🚨 ISSUES IDENTIFIED');
      lines.push('─'.repeat(65));
      for (const issue of result.issues.slice(0, 10)) {
        const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'HIGH' ? '🟠' : '🟡';
        lines.push(`  ${icon} [${issue.severity}] ${issue.description}`);
        lines.push(`     Entity: ${issue.entity}`);
        if (issue.impact) lines.push(`     Impact: ${issue.impact}`);
      }
      lines.push('');
    }

    // Wasted Spend
    if (result.wastedSpend.length > 0) {
      lines.push('💸 WASTED SPEND (Top Search Terms with $0 Return)');
      lines.push('─'.repeat(65));
      for (const term of result.wastedSpend.slice(0, 10)) {
        lines.push(`  "$${term.cost.toFixed(2)}" - "${term.term}"`);
      }
      lines.push('');
    }

    // Recommendations
    if (result.recommendations.length > 0) {
      lines.push('💡 RECOMMENDATIONS');
      lines.push('─'.repeat(65));
      for (const rec of result.recommendations) {
        lines.push(`  ${rec.priority}. ${rec.action}`);
        lines.push(`     Reason: ${rec.reason}`);
        lines.push(`     Impact: ${rec.expectedImpact}`);
        lines.push('');
      }
    }

    // Actions
    if (result.actionsToExecute.length > 0) {
      lines.push('⚡ ACTIONS TO EXECUTE');
      lines.push('─'.repeat(65));
      for (const action of result.actionsToExecute.slice(0, 20)) {
        const status = action.executed ? '✓' : '○';
        lines.push(`  ${status} ${action.type}: ${action.entityName}`);
      }
      lines.push('');
    }

    lines.push('═'.repeat(65));
    lines.push('  END OF REPORT');
    lines.push('═'.repeat(65));

    return lines.join('\n');
  }
}

// CLI execution
async function main() {
  const agent = new GoogleAdsPPCAgent({
    customerId: '9926142954', // Chisholm Law Firm
    targetCPL: 80, // Target CPL goal
    dryRun: true,
  });

  try {
    const result = await agent.analyze();
    console.log('');
    console.log(agent.generateReport(result));
  } catch (error) {
    console.error('Analysis failed:', error);
  }
}

main();
