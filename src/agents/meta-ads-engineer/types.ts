export interface CampaignAnalysis {
  campaignId: string;
  campaignName: string;
  status: string;
  objective: string;
  spend: number;
  budget: number;
  leads: number;
  cpl: number;
  ctr: number;
  cpm: number;
  frequency: number;
  impressions: number;
  clicks: number;
  reach: number;
  spendPacing: number; // percentage of budget used
  projectedMonthlySpend: number;
  healthStatus: 'healthy' | 'warning' | 'critical' | 'learning';
  issues: AnalysisIssue[];
  adSets: AdSetAnalysis[];
}

export interface AdSetAnalysis {
  adSetId: string;
  adSetName: string;
  campaignId: string;
  status: string;
  spend: number;
  budget: number;
  leads: number;
  cpl: number;
  ctr: number;
  frequency: number;
  impressions: number;
  saturationScore: number; // 0-100, higher = more saturated
  healthStatus: 'healthy' | 'warning' | 'critical' | 'learning';
  issues: AnalysisIssue[];
  ads: AdAnalysis[];
}

export interface AdAnalysis {
  adId: string;
  adName: string;
  adSetId: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  leads: number;
  cpl: number;
  frequency: number;
  classification: 'winner' | 'loser' | 'testing' | 'fatigued' | 'new';
  fatigueScore: number; // 0-100, higher = more fatigued
  issues: AnalysisIssue[];
}

export interface AnalysisIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  metric?: string;
  recommendation?: string;
}

export interface ProposedAction {
  action_type: string;
  entity_type: 'campaign' | 'adset' | 'ad';
  entity_id: string;
  entity_name: string;
  description: string;
  reasoning: string;
  change_percent?: number;
  current_value?: number | string;
  new_value?: number | string;
  auto_execute: boolean;
  expected_impact: string;
  metadata?: Record<string, unknown>;
}

export interface FullAnalysisResult {
  clientId: string;
  clientName: string;
  practiceArea?: string;
  targetCpl: number;
  timestamp: string;
  campaigns: CampaignAnalysis[];
  proposedActions: ProposedAction[];
  summary: AnalysisSummary;
  claudeInsights?: string;
}

export interface AnalysisSummary {
  totalSpend: number;
  totalLeads: number;
  avgCpl: number;
  avgCtr: number;
  healthyCampaigns: number;
  warningCampaigns: number;
  criticalCampaigns: number;
  winnersCount: number;
  losersCount: number;
  fatiguedAdsCount: number;
  proposedActionsCount: number;
  autoExecuteCount: number;
  needsApprovalCount: number;
}

export interface ScalingCandidate {
  adSetId: string;
  adSetName: string;
  campaignId: string;
  currentBudget: number;
  cpl: number;
  targetCpl: number;
  leads: number;
  daysStable: number;
  scalingPhase: 0 | 1 | 2 | 3;
  nextAction: string;
}
