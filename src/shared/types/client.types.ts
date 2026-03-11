/**
 * Client Types for Multi-Client Architecture
 */

export interface Client {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused' | 'onboarding' | 'churned';
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientGoogleAdsConfig {
  clientId: string;
  customerId: string;
  loginCustomerId?: string;
  targetCpl: number;
  dailyBudget?: number;
  monthlyBudget?: number;
  timezone: string;
  currency: string;
  conversionActions?: string[];
}

export interface ClientCredentials {
  clientId: string;
  platform: 'google_ads' | 'facebook_ads' | 'linkedin' | 'slack';
  credentials: {
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    developerToken?: string;
    [key: string]: string | undefined;
  };
  expiresAt?: Date;
  isValid: boolean;
}

export interface ClientSettings {
  clientId: string;
  notifications: {
    email: boolean;
    slack: boolean;
    slackChannel?: string;
  };
  alerts: {
    cplThreshold: number;
    spendThreshold: number;
    conversionDropPercent: number;
  };
  automations: {
    autoApplyNegatives: boolean;
    autoPauseLowPerformers: boolean;
    autoAdjustBids: boolean;
  };
}

export interface AnalysisRun {
  id: string;
  clientId: string;
  runType: 'manual' | 'scheduled' | 'triggered';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  results?: AnalysisResults;
  error?: string;
}

export interface AnalysisResults {
  period: {
    start: string;
    end: string;
  };
  metrics: {
    totalSpend: number;
    totalConversions: number;
    avgCpl: number;
    avgCtr: number;
    impressionShare: number;
  };
  recommendations: Recommendation[];
  actions: Action[];
  insights: Insight[];
}

export interface Recommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'executed';
}

export interface Action {
  id: string;
  type: 'add_negative' | 'pause_campaign' | 'enable_campaign' | 'adjust_bid' | 'add_keyword';
  status: 'pending' | 'approved' | 'executed' | 'failed';
  target: {
    campaignId?: string;
    campaignName?: string;
    adGroupId?: string;
    keywordId?: string;
    keyword?: string;
  };
  details: Record<string, any>;
  executedAt?: Date;
  result?: string;
}

export interface Insight {
  category: string;
  insight: string;
  implication: 'positive' | 'negative' | 'neutral';
  recommendation: string;
  dataPoints?: Record<string, number | string>;
}

export interface Alert {
  id: string;
  clientId: string;
  severity: 'critical' | 'warning' | 'info';
  type: 'cpl_spike' | 'spend_anomaly' | 'conversion_drop' | 'impression_share_loss' | 'quality_score_drop';
  title: string;
  message: string;
  data: Record<string, any>;
  status: 'active' | 'acknowledged' | 'resolved';
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

// Database schema types (for Supabase)
export interface ClientRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  google_ads_customer_id: string | null;
  google_ads_login_customer_id: string | null;
  target_cpl: number;
  daily_budget: number | null;
  monthly_budget: number | null;
  timezone: string;
  currency: string;
  notification_email: boolean;
  notification_slack: boolean;
  slack_channel: string | null;
  auto_apply_negatives: boolean;
  auto_pause_low_performers: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnalysisRunRow {
  id: string;
  client_id: string;
  run_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  results_json: string | null;
  error: string | null;
}

export interface ActionRow {
  id: string;
  client_id: string;
  analysis_run_id: string | null;
  action_type: string;
  status: string;
  target_json: string;
  details_json: string;
  executed_at: string | null;
  result: string | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  client_id: string;
  severity: string;
  alert_type: string;
  title: string;
  message: string;
  data_json: string;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

// Helper functions
export function clientRowToClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as Client['status'],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function clientRowToGoogleAdsConfig(row: ClientRow): ClientGoogleAdsConfig | null {
  if (!row.google_ads_customer_id) return null;

  return {
    clientId: row.id,
    customerId: row.google_ads_customer_id,
    loginCustomerId: row.google_ads_login_customer_id || undefined,
    targetCpl: row.target_cpl,
    dailyBudget: row.daily_budget || undefined,
    monthlyBudget: row.monthly_budget || undefined,
    timezone: row.timezone,
    currency: row.currency,
  };
}

export function clientRowToSettings(row: ClientRow): ClientSettings {
  return {
    clientId: row.id,
    notifications: {
      email: row.notification_email,
      slack: row.notification_slack,
      slackChannel: row.slack_channel || undefined,
    },
    alerts: {
      cplThreshold: row.target_cpl * 1.5, // Alert when CPL exceeds 150% of target
      spendThreshold: row.daily_budget ? row.daily_budget * 1.2 : 10000,
      conversionDropPercent: 30,
    },
    automations: {
      autoApplyNegatives: row.auto_apply_negatives,
      autoPauseLowPerformers: row.auto_pause_low_performers,
      autoAdjustBids: false,
    },
  };
}
