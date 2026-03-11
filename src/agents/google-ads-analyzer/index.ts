/**
 * GoBoom GTM Agents — Google Ads Analyzer Agent
 *
 * Autonomous agent that analyzes Google Ads campaigns, identifies issues,
 * proposes fixes, and executes approved changes.
 */

import { createLogger } from '../../shared/utils/logger.js';
import {
  GoogleAdsClient,
  createGoogleAdsClient,
  CampaignAnalysis,
  Recommendation,
  Issue,
} from '../../shared/clients/google-ads.js';

const logger = createLogger('google-ads-analyzer');

export interface ClientConfig {
  clientId: string;
  clientName: string;
  googleAdsCustomerId: string;
  targetCPL: number;
  monthlyBudget?: number;
  notifySlackChannel?: string;
}

export interface AnalysisResult {
  clientId: string;
  clientName: string;
  timestamp: string;
  analysis: CampaignAnalysis;
  pendingActions: PendingAction[];
}

export interface PendingAction {
  id: string;
  type: 'PAUSE_CAMPAIGN' | 'ENABLE_CAMPAIGN' | 'ADJUST_BUDGET' | 'ADD_NEGATIVE_KEYWORD';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  impact: string;
  entityType: 'campaign' | 'ad_group' | 'keyword';
  entityId: string;
  entityName: string;
  currentValue?: string;
  proposedValue?: string;
  autoExecute: boolean;
  requiresApproval: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  createdAt: string;
}

export interface AnalyzerConfig {
  autoExecuteSafeActions: boolean;
  budgetChangeThreshold: number; // Percentage change that requires approval
  notifyOnIssues: boolean;
  dryRun: boolean;
}

export class GoogleAdsAnalyzer {
  private client: GoogleAdsClient;
  private config: AnalyzerConfig;
  private pendingActions: Map<string, PendingAction[]> = new Map();

  constructor(config: Partial<AnalyzerConfig> = {}) {
    this.client = createGoogleAdsClient();
    this.config = {
      autoExecuteSafeActions: false,
      budgetChangeThreshold: 20,
      notifyOnIssues: true,
      dryRun: true,
      ...config,
    };
  }

  // ============================================================
  // Analysis
  // ============================================================

  async analyzeClient(clientConfig: ClientConfig): Promise<AnalysisResult> {
    logger.info({ clientName: clientConfig.clientName }, 'Starting client analysis');

    // Get date range for last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const dateRange = {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };

    try {
      const analysis = await this.client.analyzeAccount(
        clientConfig.googleAdsCustomerId,
        dateRange,
        clientConfig.targetCPL
      );

      // Generate pending actions from recommendations
      const pendingActions = this.generatePendingActions(
        clientConfig,
        analysis.recommendations,
        analysis.issues
      );

      const result: AnalysisResult = {
        clientId: clientConfig.clientId,
        clientName: clientConfig.clientName,
        timestamp: new Date().toISOString(),
        analysis,
        pendingActions,
      };

      // Store pending actions
      this.pendingActions.set(clientConfig.clientId, pendingActions);

      // Auto-execute safe actions if enabled
      if (this.config.autoExecuteSafeActions && !this.config.dryRun) {
        await this.executeAutoActions(clientConfig, pendingActions);
      }

      logger.info({
        clientName: clientConfig.clientName,
        totalSpend: analysis.overview.totalSpend,
        totalConversions: analysis.overview.totalConversions,
        averageCPL: analysis.overview.averageCPL,
        pendingActions: pendingActions.length,
      }, 'Analysis complete');

      return result;
    } catch (error) {
      logger.error({ error, clientName: clientConfig.clientName }, 'Analysis failed');
      throw error;
    }
  }

  private generatePendingActions(
    clientConfig: ClientConfig,
    recommendations: Recommendation[],
    issues: Issue[]
  ): PendingAction[] {
    const actions: PendingAction[] = [];
    let actionId = 1;

    // Generate actions from recommendations
    for (const rec of recommendations) {
      if (rec.type === 'BUDGET' && rec.campaignId) {
        const isBudgetIncrease = rec.description.toLowerCase().includes('increase');
        const changeAmount = isBudgetIncrease ? 20 : -30; // 20% increase or 30% decrease

        actions.push({
          id: `action-${actionId++}`,
          type: 'ADJUST_BUDGET',
          priority: rec.priority,
          description: rec.description,
          impact: rec.impact,
          entityType: 'campaign',
          entityId: rec.campaignId,
          entityName: rec.description.match(/"([^"]+)"/)?.[ 1] || 'Unknown',
          currentValue: 'Current budget',
          proposedValue: `${changeAmount > 0 ? '+' : ''}${changeAmount}% budget change`,
          autoExecute: Math.abs(changeAmount) <= this.config.budgetChangeThreshold,
          requiresApproval: Math.abs(changeAmount) > this.config.budgetChangeThreshold,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Generate actions from critical issues
    for (const issue of issues) {
      if (issue.severity === 'CRITICAL' && issue.type === 'HIGH_CPL') {
        // Extract campaign name from description
        const campaignMatch = issue.description.match(/"([^"]+)"/);
        const campaignName = campaignMatch?.[1] || 'Unknown';

        actions.push({
          id: `action-${actionId++}`,
          type: 'PAUSE_CAMPAIGN',
          priority: 'HIGH',
          description: `Pause underperforming campaign: ${campaignName}`,
          impact: issue.suggestedFix,
          entityType: 'campaign',
          entityId: '', // Would need to look up
          entityName: campaignName,
          autoExecute: false, // Pausing campaigns always requires approval
          requiresApproval: true,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        });
      }
    }

    return actions;
  }

  private async executeAutoActions(
    clientConfig: ClientConfig,
    actions: PendingAction[]
  ): Promise<void> {
    const autoActions = actions.filter(a => a.autoExecute && !a.requiresApproval);

    for (const action of autoActions) {
      try {
        await this.executeAction(clientConfig.googleAdsCustomerId, action);
        action.status = 'EXECUTED';
        logger.info({ action: action.description }, 'Auto-executed action');
      } catch (error) {
        logger.error({ error, action: action.description }, 'Failed to auto-execute action');
      }
    }
  }

  // ============================================================
  // Action Execution
  // ============================================================

  async approveAction(clientId: string, actionId: string): Promise<void> {
    const actions = this.pendingActions.get(clientId);
    if (!actions) {
      throw new Error(`No pending actions for client ${clientId}`);
    }

    const action = actions.find(a => a.id === actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    action.status = 'APPROVED';
    logger.info({ clientId, actionId }, 'Action approved');
  }

  async rejectAction(clientId: string, actionId: string, reason?: string): Promise<void> {
    const actions = this.pendingActions.get(clientId);
    if (!actions) {
      throw new Error(`No pending actions for client ${clientId}`);
    }

    const action = actions.find(a => a.id === actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    action.status = 'REJECTED';
    logger.info({ clientId, actionId, reason }, 'Action rejected');
  }

  async executeApprovedActions(clientId: string, customerId: string): Promise<void> {
    const actions = this.pendingActions.get(clientId);
    if (!actions) {
      throw new Error(`No pending actions for client ${clientId}`);
    }

    const approvedActions = actions.filter(a => a.status === 'APPROVED');

    for (const action of approvedActions) {
      try {
        await this.executeAction(customerId, action);
        action.status = 'EXECUTED';
        logger.info({ action: action.description }, 'Executed approved action');
      } catch (error) {
        logger.error({ error, action: action.description }, 'Failed to execute action');
      }
    }
  }

  private async executeAction(customerId: string, action: PendingAction): Promise<void> {
    if (this.config.dryRun) {
      logger.info({ action: action.description }, 'Dry run - would execute action');
      return;
    }

    switch (action.type) {
      case 'PAUSE_CAMPAIGN':
        await this.client.pauseCampaign(customerId, action.entityId);
        break;
      case 'ENABLE_CAMPAIGN':
        await this.client.enableCampaign(customerId, action.entityId);
        break;
      case 'ADD_NEGATIVE_KEYWORD':
        // Would need keyword text stored in action
        break;
      case 'ADJUST_BUDGET':
        // Would need actual budget amounts
        break;
    }
  }

  // ============================================================
  // Reporting
  // ============================================================

  generateReport(result: AnalysisResult): string {
    const { analysis, clientName, pendingActions } = result;
    const lines: string[] = [];

    lines.push(`═══════════════════════════════════════════════════════════════`);
    lines.push(`  GOOGLE ADS ANALYSIS REPORT: ${clientName.toUpperCase()}`);
    lines.push(`  Generated: ${new Date().toLocaleString()}`);
    lines.push(`═══════════════════════════════════════════════════════════════`);
    lines.push('');

    // Overview
    lines.push(`📊 ACCOUNT OVERVIEW (Last 30 Days)`);
    lines.push(`───────────────────────────────────────────────────────────────`);
    lines.push(`  Total Spend:        $${analysis.overview.totalSpend.toFixed(2)}`);
    lines.push(`  Total Conversions:  ${analysis.overview.totalConversions.toFixed(0)}`);
    lines.push(`  Average CPL:        $${analysis.overview.averageCPL.toFixed(2)}`);
    lines.push(`  Overall CTR:        ${analysis.overview.overallCTR.toFixed(2)}%`);
    lines.push(`  Active Campaigns:   ${analysis.overview.activeCampaigns}`);
    lines.push('');

    // Top Performers
    if (analysis.topPerformers.length > 0) {
      lines.push(`🏆 TOP PERFORMERS`);
      lines.push(`───────────────────────────────────────────────────────────────`);
      for (const camp of analysis.topPerformers) {
        lines.push(`  • ${camp.campaignName}`);
        lines.push(`    CPL: $${camp.costPerConversion.toFixed(2)} | Conv: ${camp.conversions} | Spend: $${camp.cost.toFixed(2)}`);
      }
      lines.push('');
    }

    // Underperformers
    if (analysis.underperformers.length > 0) {
      lines.push(`⚠️  UNDERPERFORMERS`);
      lines.push(`───────────────────────────────────────────────────────────────`);
      for (const camp of analysis.underperformers) {
        lines.push(`  • ${camp.campaignName}`);
        lines.push(`    CPL: $${camp.costPerConversion.toFixed(2)} | Conv: ${camp.conversions} | Spend: $${camp.cost.toFixed(2)}`);
      }
      lines.push('');
    }

    // Issues
    if (analysis.issues.length > 0) {
      lines.push(`🚨 ISSUES DETECTED`);
      lines.push(`───────────────────────────────────────────────────────────────`);
      for (const issue of analysis.issues) {
        const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'WARNING' ? '🟡' : '🔵';
        lines.push(`  ${icon} [${issue.severity}] ${issue.description}`);
        lines.push(`     Fix: ${issue.suggestedFix}`);
      }
      lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      lines.push(`💡 RECOMMENDATIONS`);
      lines.push(`───────────────────────────────────────────────────────────────`);
      for (const rec of analysis.recommendations) {
        const priority = rec.priority === 'HIGH' ? '🔴' : rec.priority === 'MEDIUM' ? '🟡' : '🟢';
        lines.push(`  ${priority} ${rec.description}`);
        lines.push(`     Impact: ${rec.impact}`);
        lines.push(`     Action: ${rec.action}`);
      }
      lines.push('');
    }

    // Pending Actions
    if (pendingActions.length > 0) {
      lines.push(`📋 PENDING ACTIONS (${pendingActions.length})`);
      lines.push(`───────────────────────────────────────────────────────────────`);
      for (const action of pendingActions) {
        const approval = action.requiresApproval ? '[NEEDS APPROVAL]' : '[AUTO]';
        lines.push(`  ${action.id}: ${action.description} ${approval}`);
      }
      lines.push('');
    }

    lines.push(`═══════════════════════════════════════════════════════════════`);
    lines.push(`  End of Report`);
    lines.push(`═══════════════════════════════════════════════════════════════`);

    return lines.join('\n');
  }

  // ============================================================
  // Getters
  // ============================================================

  getPendingActions(clientId: string): PendingAction[] {
    return this.pendingActions.get(clientId) || [];
  }

  getAllPendingActions(): Map<string, PendingAction[]> {
    return this.pendingActions;
  }
}

export function createGoogleAdsAnalyzer(config?: Partial<AnalyzerConfig>): GoogleAdsAnalyzer {
  return new GoogleAdsAnalyzer(config);
}
