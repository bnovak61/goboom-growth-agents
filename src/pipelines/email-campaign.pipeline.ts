import { createLogger } from '../shared/utils/logger.js';
import { instantly } from '../shared/clients/instantly.js';
import { millionVerifier } from '../shared/clients/million-verifier.js';
import { Lead } from '../shared/types/lead.types.js';
import {
  PipelineRun,
  PipelineStepResult,
} from '../shared/types/pipeline.types.js';

const logger = createLogger('email-campaign-pipeline');

export interface EmailCampaignConfig {
  campaignId: string;
  verifyBeforeSending: boolean;
  batchSize: number;
  deduplicateEmails: boolean;
}

export class EmailCampaignPipeline {
  private config: EmailCampaignConfig;

  constructor(config: Partial<EmailCampaignConfig> & { campaignId: string }) {
    this.config = {
      campaignId: config.campaignId,
      verifyBeforeSending: config.verifyBeforeSending ?? true,
      batchSize: config.batchSize ?? 100,
      deduplicateEmails: config.deduplicateEmails ?? true,
    };
  }

  async process(leads: Lead[]): Promise<{
    addedLeads: Lead[];
    run: PipelineRun;
  }> {
    const runId = `run-${Date.now()}`;
    const run: PipelineRun = {
      id: runId,
      pipelineId: 'email-campaign',
      status: 'running',
      startedAt: new Date(),
      steps: [],
      totalInputs: leads.length,
      totalOutputs: 0,
      errors: [],
      metadata: { campaignId: this.config.campaignId },
    };

    logger.info(
      { runId, inputCount: leads.length, campaignId: this.config.campaignId },
      'Starting email campaign pipeline'
    );

    let currentLeads = [...leads];

    // Stage 1: Deduplicate
    if (this.config.deduplicateEmails) {
      const dedupeResult = this.deduplicateLeads(currentLeads);
      run.steps.push(dedupeResult.step);
      currentLeads = dedupeResult.leads;
    }

    // Stage 2: Verify emails
    if (this.config.verifyBeforeSending) {
      const verifyResult = await this.verifyEmails(currentLeads);
      run.steps.push(verifyResult.step);
      currentLeads = verifyResult.leads;
    }

    // Stage 3: Filter leads without valid emails
    const filterResult = this.filterValidLeads(currentLeads);
    run.steps.push(filterResult.step);
    currentLeads = filterResult.leads;

    // Stage 4: Add to Instantly in batches
    const sendResult = await this.addToInstantly(currentLeads);
    run.steps.push(sendResult.step);
    currentLeads = sendResult.leads;

    // Complete the run
    run.status = run.errors.length > 0 ? 'failed' : 'completed';
    run.completedAt = new Date();
    run.totalOutputs = sendResult.addedCount;

    logger.info(
      {
        runId,
        inputCount: leads.length,
        outputCount: sendResult.addedCount,
        status: run.status,
      },
      'Email campaign pipeline completed'
    );

    return {
      addedLeads: currentLeads.slice(0, sendResult.addedCount),
      run,
    };
  }

  private deduplicateLeads(leads: Lead[]): {
    leads: Lead[];
    step: PipelineStepResult;
  } {
    const startTime = Date.now();
    const seen = new Set<string>();
    const uniqueLeads: Lead[] = [];

    for (const lead of leads) {
      if (lead.email && !seen.has(lead.email.toLowerCase())) {
        seen.add(lead.email.toLowerCase());
        uniqueLeads.push(lead);
      }
    }

    return {
      leads: uniqueLeads,
      step: {
        stage: 'filter',
        status: 'success',
        inputCount: leads.length,
        outputCount: uniqueLeads.length,
        duration: Date.now() - startTime,
        metadata: {
          duplicatesRemoved: leads.length - uniqueLeads.length,
        },
      },
    };
  }

  private async verifyEmails(leads: Lead[]): Promise<{
    leads: Lead[];
    step: PipelineStepResult;
  }> {
    const startTime = Date.now();

    try {
      const unverifiedLeads = leads.filter((l) => l.email && !l.emailVerified);
      const emails = unverifiedLeads.map((l) => l.email!);

      if (emails.length === 0) {
        return {
          leads,
          step: {
            stage: 'verify',
            status: 'skipped',
            inputCount: leads.length,
            outputCount: leads.length,
            duration: Date.now() - startTime,
            metadata: {},
          },
        };
      }

      const results = await millionVerifier.verifyMultiple(emails);
      let verifiedCount = 0;

      const verifiedLeads = leads.map((lead) => {
        if (!lead.email) return lead;
        if (lead.emailVerified) return lead;

        const result = results.get(lead.email);
        if (result?.isValid) {
          verifiedCount++;
          return { ...lead, emailVerified: true };
        }
        return lead;
      });

      return {
        leads: verifiedLeads,
        step: {
          stage: 'verify',
          status: 'success',
          inputCount: leads.length,
          outputCount: verifiedLeads.length,
          duration: Date.now() - startTime,
          metadata: { verifiedCount },
        },
      };
    } catch (error) {
      logger.error({ error }, 'Email verification failed');
      return {
        leads,
        step: {
          stage: 'verify',
          status: 'failed',
          inputCount: leads.length,
          outputCount: leads.length,
          duration: Date.now() - startTime,
          error: String(error),
          metadata: {},
        },
      };
    }
  }

  private filterValidLeads(leads: Lead[]): {
    leads: Lead[];
    step: PipelineStepResult;
  } {
    const startTime = Date.now();

    const validLeads = leads.filter((lead) => {
      if (!lead.email) return false;
      if (this.config.verifyBeforeSending && !lead.emailVerified) return false;
      return true;
    });

    return {
      leads: validLeads,
      step: {
        stage: 'filter',
        status: 'success',
        inputCount: leads.length,
        outputCount: validLeads.length,
        duration: Date.now() - startTime,
        metadata: {
          invalidRemoved: leads.length - validLeads.length,
        },
      },
    };
  }

  private async addToInstantly(leads: Lead[]): Promise<{
    leads: Lead[];
    addedCount: number;
    step: PipelineStepResult;
  }> {
    const startTime = Date.now();

    if (leads.length === 0) {
      return {
        leads: [],
        addedCount: 0,
        step: {
          stage: 'send',
          status: 'skipped',
          inputCount: 0,
          outputCount: 0,
          duration: Date.now() - startTime,
          metadata: {},
        },
      };
    }

    try {
      let totalAdded = 0;
      const addedLeads: Lead[] = [];

      // Process in batches
      for (let i = 0; i < leads.length; i += this.config.batchSize) {
        const batch = leads.slice(i, i + this.config.batchSize);
        const result = await instantly.addLeadsToCampaign(
          this.config.campaignId,
          batch
        );
        totalAdded += result.uploaded ?? 0;
        addedLeads.push(...batch.slice(0, result.uploaded ?? 0));

        logger.debug(
          { batchNumber: Math.floor(i / this.config.batchSize) + 1, added: result.uploaded },
          'Processed batch'
        );
      }

      return {
        leads: addedLeads,
        addedCount: totalAdded,
        step: {
          stage: 'send',
          status: 'success',
          inputCount: leads.length,
          outputCount: totalAdded,
          duration: Date.now() - startTime,
          metadata: {
            campaignId: this.config.campaignId,
            totalAdded,
          },
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to add leads to Instantly');
      return {
        leads: [],
        addedCount: 0,
        step: {
          stage: 'send',
          status: 'failed',
          inputCount: leads.length,
          outputCount: 0,
          duration: Date.now() - startTime,
          error: String(error),
          metadata: {},
        },
      };
    }
  }
}

export function createEmailCampaignPipeline(
  config: EmailCampaignConfig
): EmailCampaignPipeline {
  return new EmailCampaignPipeline(config);
}
