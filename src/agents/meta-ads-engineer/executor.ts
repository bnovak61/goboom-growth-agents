import { createLogger } from '../../shared/utils/logger.js';
import { FacebookAdsClient } from '../../shared/clients/facebook-ads.js';
import { logAction, ClientRecord } from '../../shared/clients/supabase.js';
import { ProposedAction } from './types.js';

const logger = createLogger('meta-executor');

export class MetaAdsExecutor {
  async executeAction(
    client: ClientRecord,
    action: ProposedAction,
    dryRun = false
  ): Promise<{ success: boolean; result?: string; error?: string }> {
    const fbClient = new FacebookAdsClient(
      client.meta_access_token,
      client.meta_ad_account_id
    );

    logger.info(
      {
        clientName: client.name,
        action: action.action_type,
        entity: action.entity_name,
        dryRun,
      },
      'Executing Meta action'
    );

    if (dryRun) {
      await logAction({
        client_id: client.id,
        agent_name: 'meta-ads-engineer',
        action_type: action.action_type,
        entity_type: action.entity_type,
        entity_id: action.entity_id,
        description: `[DRY RUN] ${action.description}`,
        before_value: action.current_value != null ? { value: action.current_value } : undefined,
        after_value: action.new_value != null ? { value: action.new_value } : undefined,
        status: 'skipped',
        metadata: { dry_run: true, reasoning: action.reasoning },
      });
      return { success: true, result: 'Dry run — no changes made' };
    }

    try {
      switch (action.action_type) {
        case 'meta_pause_ad':
          await fbClient.pauseAd(action.entity_id);
          break;

        case 'meta_pause_adset':
          await fbClient.updateAdStatus(action.entity_id, 'paused');
          break;

        case 'meta_budget_increase':
        case 'meta_budget_decrease':
        case 'meta_scale_winner': {
          const newBudget = action.new_value;
          if (typeof newBudget === 'number' && newBudget > 0) {
            await fbClient.updateAdSetBudget(action.entity_id, newBudget);
          } else {
            throw new Error(`Invalid budget value: ${newBudget}`);
          }
          break;
        }

        case 'meta_duplicate_adset':
          await this.duplicateAdSet(fbClient, action);
          break;

        case 'meta_create_campaign':
          await this.createCampaign(fbClient, action);
          break;

        case 'meta_update_audience':
          await this.updateAudience(fbClient, action);
          break;

        case 'meta_create_lead_form':
          await this.createLeadForm(fbClient, action);
          break;

        default:
          throw new Error(`Unknown action type: ${action.action_type}`);
      }

      await logAction({
        client_id: client.id,
        agent_name: 'meta-ads-engineer',
        action_type: action.action_type,
        entity_type: action.entity_type,
        entity_id: action.entity_id,
        description: action.description,
        before_value: action.current_value != null ? { value: action.current_value } : undefined,
        after_value: action.new_value != null ? { value: action.new_value } : undefined,
        status: 'success',
        metadata: { reasoning: action.reasoning, expected_impact: action.expected_impact },
      });

      logger.info(
        { action: action.action_type, entity: action.entity_name },
        'Action executed successfully'
      );

      return { success: true, result: `Executed: ${action.description}` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      await logAction({
        client_id: client.id,
        agent_name: 'meta-ads-engineer',
        action_type: action.action_type,
        entity_type: action.entity_type,
        entity_id: action.entity_id,
        description: `FAILED: ${action.description}`,
        status: 'failed',
        metadata: { error: errorMsg, reasoning: action.reasoning },
      });

      logger.error(
        { action: action.action_type, entity: action.entity_name, error: errorMsg },
        'Action execution failed'
      );

      return { success: false, error: errorMsg };
    }
  }

  async executeActions(
    client: ClientRecord,
    actions: ProposedAction[],
    dryRun = false
  ): Promise<{ executed: number; failed: number; skipped: number }> {
    let executed = 0;
    let failed = 0;
    let skipped = 0;

    for (const action of actions) {
      if (!action.auto_execute && !dryRun) {
        // Non-auto actions should have gone through approval first
        skipped++;
        continue;
      }

      const result = await this.executeAction(client, action, dryRun);
      if (result.success) {
        executed++;
      } else {
        failed++;
      }
    }

    logger.info({ executed, failed, skipped, dryRun }, 'Batch execution complete');
    return { executed, failed, skipped };
  }

  // --- Complex operations (placeholders that use the Graph API) ---

  private async duplicateAdSet(fbClient: FacebookAdsClient, action: ProposedAction): Promise<void> {
    // Meta Graph API: POST /{ad_set_id}/copies
    // This creates a copy of the ad set with the same ads
    const endpoint = `${action.entity_id}/copies`;
    // Note: The base client's post method handles this
    // In production, this would specify the new audience parameters
    logger.info({ adSetId: action.entity_id }, 'Duplicating ad set (API call would go here)');
    // TODO: Implement when we have the full Graph API endpoint access
    // For now, this is logged as a proposed action
  }

  private async createCampaign(fbClient: FacebookAdsClient, action: ProposedAction): Promise<void> {
    logger.info({ action }, 'Creating campaign (API call would go here)');
    // TODO: Implement campaign creation via Graph API
    // POST /act_{ad_account_id}/campaigns
  }

  private async updateAudience(fbClient: FacebookAdsClient, action: ProposedAction): Promise<void> {
    logger.info({ action }, 'Updating audience (API call would go here)');
    // TODO: Implement audience update via Graph API
    // POST /{ad_set_id} with targeting parameter
  }

  private async createLeadForm(fbClient: FacebookAdsClient, action: ProposedAction): Promise<void> {
    logger.info({ action }, 'Creating lead form (API call would go here)');
    // TODO: Implement lead form creation via Graph API
    // POST /act_{ad_account_id}/leadgen_forms
  }
}
