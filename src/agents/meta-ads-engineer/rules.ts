import { AdAnalysis, AdSetAnalysis, CampaignAnalysis, ProposedAction } from './types.js';
import { PracticeAreaBenchmark } from './benchmarks.js';

// --- Ad-level rules ---

export function evaluateAdRules(
  ad: AdAnalysis,
  adSet: AdSetAnalysis,
  benchmark: PracticeAreaBenchmark,
  targetCpl: number
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  // Rule: Pause ad with CTR < 0.5% after 1000 impressions
  if (ad.ctr < 0.5 && ad.impressions > 1000 && ad.status === 'active') {
    actions.push({
      action_type: 'meta_pause_ad',
      entity_type: 'ad',
      entity_id: ad.adId,
      entity_name: ad.adName,
      description: `Pause ad — CTR ${ad.ctr.toFixed(2)}% is below 0.5% threshold`,
      reasoning: `After ${ad.impressions} impressions, CTR of ${ad.ctr.toFixed(2)}% indicates poor creative or audience fit`,
      current_value: ad.ctr,
      new_value: 'paused',
      auto_execute: true,
      expected_impact: `Save $${ad.spend > 0 ? (ad.spend * 0.5).toFixed(2) : '0'}/day on underperforming ad`,
    });
  }

  // Rule: Pause fatigued ad (frequency > 3 + CTR declining)
  if (ad.fatigueScore > 70 && ad.frequency > 3 && ad.status === 'active') {
    actions.push({
      action_type: 'meta_pause_ad',
      entity_type: 'ad',
      entity_id: ad.adId,
      entity_name: ad.adName,
      description: `Pause fatigued ad — frequency ${ad.frequency.toFixed(1)}, fatigue score ${ad.fatigueScore}`,
      reasoning: 'High frequency with declining performance indicates audience saturation',
      current_value: ad.frequency,
      new_value: 'paused',
      auto_execute: true,
      expected_impact: 'Reduce wasted spend on ad that audience is ignoring',
    });
  }

  return actions;
}

// --- Ad Set-level rules ---

export function evaluateAdSetRules(
  adSet: AdSetAnalysis,
  campaign: CampaignAnalysis,
  benchmark: PracticeAreaBenchmark,
  targetCpl: number
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  // Rule: Pause ad set with CPL > 150% of target after 7+ days
  if (adSet.cpl > targetCpl * 1.5 && adSet.leads >= 3 && adSet.status === 'active') {
    actions.push({
      action_type: 'meta_pause_adset',
      entity_type: 'adset',
      entity_id: adSet.adSetId,
      entity_name: adSet.adSetName,
      description: `Pause ad set — CPL $${adSet.cpl.toFixed(2)} is ${Math.round((adSet.cpl / targetCpl - 1) * 100)}% above target`,
      reasoning: `CPL of $${adSet.cpl.toFixed(2)} vs target $${targetCpl} with ${adSet.leads} leads — not viable`,
      current_value: adSet.cpl,
      new_value: 'paused',
      auto_execute: true,
      expected_impact: `Save $${adSet.budget.toFixed(2)}/day`,
    });
  }

  // Rule: Decrease budget on underperforming ad set (CPL 120-150% of target)
  if (
    adSet.cpl > targetCpl * 1.2 &&
    adSet.cpl <= targetCpl * 1.5 &&
    adSet.leads >= 2 &&
    adSet.budget > 0 &&
    adSet.status === 'active'
  ) {
    const decreasePercent = 30;
    const newBudget = adSet.budget * (1 - decreasePercent / 100);
    actions.push({
      action_type: 'meta_budget_decrease',
      entity_type: 'adset',
      entity_id: adSet.adSetId,
      entity_name: adSet.adSetName,
      description: `Decrease budget by ${decreasePercent}% — CPL $${adSet.cpl.toFixed(2)} is above target`,
      reasoning: `CPL trending high but not critical — reduce budget to limit exposure`,
      change_percent: decreasePercent,
      current_value: adSet.budget,
      new_value: newBudget,
      auto_execute: true,
      expected_impact: `Reduce daily spend by $${(adSet.budget - newBudget).toFixed(2)}`,
    });
  }

  // Rule: Increase budget on winner (CPL < target, <= 20% increase)
  if (
    adSet.cpl > 0 &&
    adSet.cpl < targetCpl * 0.8 &&
    adSet.leads >= 5 &&
    adSet.budget > 0 &&
    adSet.status === 'active'
  ) {
    const increasePercent = 20;
    const newBudget = adSet.budget * (1 + increasePercent / 100);
    actions.push({
      action_type: 'meta_budget_increase',
      entity_type: 'adset',
      entity_id: adSet.adSetId,
      entity_name: adSet.adSetName,
      description: `Increase budget by ${increasePercent}% — CPL $${adSet.cpl.toFixed(2)} is well below target`,
      reasoning: `Strong performance with CPL at ${Math.round((adSet.cpl / targetCpl) * 100)}% of target — safe to scale`,
      change_percent: increasePercent,
      current_value: adSet.budget,
      new_value: newBudget,
      auto_execute: true,
      expected_impact: `Projected additional ${Math.round(increasePercent / 100 * adSet.leads)} leads/week`,
    });
  }

  // Rule: Audience saturation warning
  if (adSet.saturationScore > 80 && adSet.status === 'active') {
    actions.push({
      action_type: 'meta_duplicate_adset',
      entity_type: 'adset',
      entity_id: adSet.adSetId,
      entity_name: adSet.adSetName,
      description: `Audience saturated (score: ${adSet.saturationScore}) — recommend duplicating to new audience`,
      reasoning: 'High frequency and declining performance indicate the audience has been exhausted',
      auto_execute: false,
      expected_impact: 'Extend reach to fresh audience segments',
    });
  }

  return actions;
}

// --- Campaign-level rules ---

export function evaluateCampaignRules(
  campaign: CampaignAnalysis,
  benchmark: PracticeAreaBenchmark,
  targetCpl: number
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  // Rule: Zero leads with significant spend
  if (campaign.leads === 0 && campaign.spend > 200 && campaign.status === 'active') {
    actions.push({
      action_type: 'meta_pause_adset',
      entity_type: 'campaign',
      entity_id: campaign.campaignId,
      entity_name: campaign.campaignName,
      description: `Zero leads with $${campaign.spend.toFixed(2)} spend — investigate or pause`,
      reasoning: 'No conversions despite significant spend indicates a fundamental issue (tracking, targeting, or landing page)',
      auto_execute: false,
      expected_impact: `Stop bleeding $${(campaign.spend / 7).toFixed(2)}/day`,
    });
  }

  // Rule: Critical CPL across all ad sets
  if (campaign.cpl > benchmark.criticalCpl && campaign.leads >= 5) {
    actions.push({
      action_type: 'meta_budget_decrease',
      entity_type: 'campaign',
      entity_id: campaign.campaignId,
      entity_name: campaign.campaignName,
      description: `Critical CPL: $${campaign.cpl.toFixed(2)} (benchmark critical: $${benchmark.criticalCpl})`,
      reasoning: `CPL is ${Math.round((campaign.cpl / benchmark.criticalCpl) * 100)}% of critical threshold for ${benchmark.practiceArea}`,
      change_percent: 30,
      current_value: campaign.budget,
      new_value: campaign.budget * 0.7,
      auto_execute: false,
      expected_impact: 'Reduce exposure while strategy is adjusted',
    });
  }

  return actions;
}
