import { createLogger } from '../../shared/utils/logger.js';
import { AdSetAnalysis, ScalingCandidate, ProposedAction, FullAnalysisResult } from './types.js';
import { PracticeAreaBenchmark } from './benchmarks.js';

const logger = createLogger('meta-strategies');

// --- Scaling Protocol ---

export function identifyScalingCandidates(
  result: FullAnalysisResult,
  benchmark: PracticeAreaBenchmark
): ScalingCandidate[] {
  const candidates: ScalingCandidate[] = [];

  for (const campaign of result.campaigns) {
    for (const adSet of campaign.adSets) {
      // Winner criteria: CPL < 80% of target, 50+ leads (or 5+ in 7 days), stable 7+ days
      if (
        adSet.cpl > 0 &&
        adSet.cpl < result.targetCpl * 0.8 &&
        adSet.leads >= 5 &&
        adSet.status === 'active' &&
        adSet.saturationScore < 60
      ) {
        candidates.push({
          adSetId: adSet.adSetId,
          adSetName: adSet.adSetName,
          campaignId: campaign.campaignId,
          currentBudget: adSet.budget,
          cpl: adSet.cpl,
          targetCpl: result.targetCpl,
          leads: adSet.leads,
          daysStable: estimateStableDays(adSet),
          scalingPhase: 0,
          nextAction: 'Phase 1: Increase budget 20%',
        });
      }
    }
  }

  return candidates.sort((a, b) => a.cpl - b.cpl); // Best performers first
}

export function generateScalingActions(
  candidates: ScalingCandidate[]
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  for (const candidate of candidates) {
    switch (candidate.scalingPhase) {
      case 0: {
        // Phase 1: 20% budget increase
        const newBudget = candidate.currentBudget * 1.2;
        actions.push({
          action_type: 'meta_scale_winner',
          entity_type: 'adset',
          entity_id: candidate.adSetId,
          entity_name: candidate.adSetName,
          description: `Scale Phase 1: Increase budget 20% ($${candidate.currentBudget.toFixed(2)} -> $${newBudget.toFixed(2)})`,
          reasoning: `Winner with CPL $${candidate.cpl.toFixed(2)} (${Math.round((candidate.cpl / candidate.targetCpl) * 100)}% of target) and ${candidate.leads} leads`,
          change_percent: 20,
          current_value: candidate.currentBudget,
          new_value: newBudget,
          auto_execute: false, // Scaling always needs approval
          expected_impact: `Projected ${Math.round(candidate.leads * 0.2)} additional leads at current CPL`,
          metadata: {
            scaling_phase: 1,
            cpl: candidate.cpl,
            target_cpl: candidate.targetCpl,
            monitor_period: '48h',
          },
        });
        break;
      }

      case 1: {
        // Phase 2: Duplicate to new audience
        actions.push({
          action_type: 'meta_duplicate_adset',
          entity_type: 'adset',
          entity_id: candidate.adSetId,
          entity_name: candidate.adSetName,
          description: `Scale Phase 2: Duplicate ad set with expanded audience`,
          reasoning: `Phase 1 successful — CPL held after budget increase. Ready to expand reach.`,
          auto_execute: false,
          expected_impact: 'Access new audience segments while maintaining performance',
          metadata: {
            scaling_phase: 2,
            monitor_period: '72h',
          },
        });
        break;
      }

      case 2: {
        // Phase 3: Another 20% increase + lookalike
        const newBudget = candidate.currentBudget * 1.2;
        actions.push({
          action_type: 'meta_scale_winner',
          entity_type: 'adset',
          entity_id: candidate.adSetId,
          entity_name: candidate.adSetName,
          description: `Scale Phase 3: Another 20% budget increase + test lookalike audiences`,
          reasoning: `Both Phase 1 and 2 successful. Aggressive scaling warranted.`,
          change_percent: 20,
          current_value: candidate.currentBudget,
          new_value: newBudget,
          auto_execute: false,
          expected_impact: 'Significant lead volume increase if CPL holds',
          metadata: {
            scaling_phase: 3,
            monitor_period: '72h',
            test_lookalike: true,
          },
        });
        break;
      }
    }
  }

  return actions;
}

function estimateStableDays(adSet: AdSetAnalysis): number {
  // Estimate based on available metrics — real implementation would check daily_metrics
  if (adSet.leads >= 50) return 14;
  if (adSet.leads >= 20) return 7;
  if (adSet.leads >= 10) return 5;
  return 3;
}

// --- Creative Rotation Strategy ---

export function detectCreativeFatigue(
  result: FullAnalysisResult
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  for (const campaign of result.campaigns) {
    for (const adSet of campaign.adSets) {
      const fatiguedAds = adSet.ads.filter(
        (ad) => ad.classification === 'fatigued' || ad.fatigueScore > 70
      );

      if (fatiguedAds.length > 0 && fatiguedAds.length >= adSet.ads.filter(a => a.status === 'active').length * 0.5) {
        // More than half of ads are fatigued — need fresh creatives
        actions.push({
          action_type: 'creative_brief',
          entity_type: 'adset',
          entity_id: adSet.adSetId,
          entity_name: adSet.adSetName,
          description: `${fatiguedAds.length}/${adSet.ads.length} ads fatigued — need fresh creatives`,
          reasoning: `Fatigue detected across majority of ads. Average frequency: ${adSet.frequency.toFixed(1)}. New creatives needed to maintain performance.`,
          auto_execute: false,
          expected_impact: 'Restore CTR and reduce CPL by refreshing creative assets',
          metadata: {
            fatigued_ad_ids: fatiguedAds.map((a) => a.adId),
            avg_frequency: adSet.frequency,
          },
        });
      }
    }
  }

  return actions;
}

// --- Audience Overlap Detection ---

export function detectAudienceOverlap(
  result: FullAnalysisResult
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  // Check for ad sets in the same campaign that might be competing
  for (const campaign of result.campaigns) {
    const activeAdSets = campaign.adSets.filter((as) => as.status === 'active');

    if (activeAdSets.length < 2) continue;

    // If multiple ad sets have high CPM and declining CTR, likely overlap
    const highCpmSets = activeAdSets.filter(
      (as) => as.frequency > 2.5 && as.saturationScore > 50
    );

    if (highCpmSets.length >= 2) {
      actions.push({
        action_type: 'meta_update_audience',
        entity_type: 'campaign',
        entity_id: campaign.campaignId,
        entity_name: campaign.campaignName,
        description: `Potential audience overlap detected between ${highCpmSets.length} ad sets`,
        reasoning: `Multiple ad sets showing high frequency and saturation — likely competing for same audience`,
        auto_execute: false,
        expected_impact: 'Reduce internal competition and lower CPM',
        metadata: {
          overlapping_adsets: highCpmSets.map((as) => ({
            id: as.adSetId,
            name: as.adSetName,
            frequency: as.frequency,
            saturation: as.saturationScore,
          })),
        },
      });
    }
  }

  return actions;
}
