export type AgentName =
  | 'orchestrator'
  | 'meta-ads-engineer'
  | 'google-ads-manager'
  | 'performance-monitor'
  | 'creative-strategist'
  | 'lead-quality'
  | 'client-reporter'
  | 'luca-integration';

export type TaskType =
  // Meta Ads
  | 'meta_analyze'
  | 'meta_pause_ad'
  | 'meta_pause_adset'
  | 'meta_budget_increase'
  | 'meta_budget_decrease'
  | 'meta_duplicate_adset'
  | 'meta_create_campaign'
  | 'meta_update_audience'
  | 'meta_create_lead_form'
  | 'meta_scale_winner'
  // Google Ads
  | 'google_analyze'
  | 'google_add_negatives'
  | 'google_pause_campaign'
  | 'google_adjust_bid'
  | 'google_adjust_budget'
  // Performance
  | 'performance_check'
  | 'anomaly_detected'
  // Creative
  | 'creative_fatigue_check'
  | 'creative_brief'
  // Lead Quality
  | 'lead_score'
  | 'lead_capi_sync'
  // Reporting
  | 'generate_report'
  // Luca
  | 'luca_pause'
  | 'luca_enable'
  | 'luca_update_budget'
  | 'luca_manual_review'
  | 'luca_update_targeting'
  | 'luca_create_campaign'
  // Generic
  | 'manual_task';

export const TASK_TO_AGENT: Record<TaskType, AgentName> = {
  meta_analyze: 'meta-ads-engineer',
  meta_pause_ad: 'meta-ads-engineer',
  meta_pause_adset: 'meta-ads-engineer',
  meta_budget_increase: 'meta-ads-engineer',
  meta_budget_decrease: 'meta-ads-engineer',
  meta_duplicate_adset: 'meta-ads-engineer',
  meta_create_campaign: 'meta-ads-engineer',
  meta_update_audience: 'meta-ads-engineer',
  meta_create_lead_form: 'meta-ads-engineer',
  meta_scale_winner: 'meta-ads-engineer',

  google_analyze: 'google-ads-manager',
  google_add_negatives: 'google-ads-manager',
  google_pause_campaign: 'google-ads-manager',
  google_adjust_bid: 'google-ads-manager',
  google_adjust_budget: 'google-ads-manager',

  performance_check: 'performance-monitor',
  anomaly_detected: 'performance-monitor',

  creative_fatigue_check: 'creative-strategist',
  creative_brief: 'creative-strategist',

  lead_score: 'lead-quality',
  lead_capi_sync: 'lead-quality',

  generate_report: 'client-reporter',

  luca_pause: 'meta-ads-engineer',
  luca_enable: 'meta-ads-engineer',
  luca_update_budget: 'meta-ads-engineer',
  luca_manual_review: 'orchestrator',
  luca_update_targeting: 'meta-ads-engineer',
  luca_create_campaign: 'meta-ads-engineer',

  manual_task: 'orchestrator',
};

// Actions that can auto-execute without approval
export const AUTO_EXECUTE_ACTIONS: Set<TaskType> = new Set([
  'meta_pause_ad',
  'meta_pause_adset',
  'meta_budget_decrease',
  'performance_check',
  'creative_fatigue_check',
  'lead_score',
  'generate_report',
  'google_add_negatives',
  'google_analyze',
  'meta_analyze',
  'luca_pause',
  'luca_enable',
]);

// Actions that always require approval regardless of client settings
export const ALWAYS_APPROVE_ACTIONS: Set<TaskType> = new Set([
  'meta_create_campaign',
  'meta_create_lead_form',
  'luca_create_campaign',
  'luca_manual_review',
]);

// Actions with threshold-based approval (budget changes)
export const THRESHOLD_ACTIONS: Set<TaskType> = new Set([
  'meta_budget_increase',
  'luca_update_budget',
  'google_adjust_budget',
  'meta_scale_winner',
]);

export interface OrchestratorConfig {
  tickIntervalMs: number;
  heartbeatIntervalMs: number;
  staleAgentThresholdMs: number;
  maxConcurrentTasks: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  tickIntervalMs: 60_000,        // 60 seconds
  heartbeatIntervalMs: 30_000,   // 30 seconds
  staleAgentThresholdMs: 300_000, // 5 minutes
  maxConcurrentTasks: 10,
};
