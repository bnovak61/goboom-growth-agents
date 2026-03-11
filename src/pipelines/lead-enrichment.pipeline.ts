import { createLogger } from '../shared/utils/logger.js';
import { apollo } from '../shared/clients/apollo.js';
import { millionVerifier } from '../shared/clients/million-verifier.js';
import { Lead } from '../shared/types/lead.types.js';
import {
  PipelineRun,
  PipelineStepResult,
  PipelineConfig,
} from '../shared/types/pipeline.types.js';

const logger = createLogger('lead-enrichment-pipeline');

export interface LeadEnrichmentConfig {
  verifyEmails: boolean;
  enrichFromApollo: boolean;
  minEnrichmentScore?: number;
}

export class LeadEnrichmentPipeline {
  private config: LeadEnrichmentConfig;
  private pipelineConfig: PipelineConfig;

  constructor(config: LeadEnrichmentConfig) {
    this.config = {
      minEnrichmentScore: 0,
      ...config,
    };

    this.pipelineConfig = {
      id: 'lead-enrichment',
      name: 'Lead Enrichment Pipeline',
      description: 'Enriches leads with Apollo data and verifies emails',
      stages: [
        { stage: 'enrich', handler: 'apollo', config: {}, continueOnError: true },
        { stage: 'verify', handler: 'million-verifier', config: {}, continueOnError: true },
        { stage: 'filter', handler: 'quality-filter', config: {}, continueOnError: false },
      ],
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async process(leads: Lead[]): Promise<{
    enrichedLeads: Lead[];
    run: PipelineRun;
  }> {
    const runId = `run-${Date.now()}`;
    const run: PipelineRun = {
      id: runId,
      pipelineId: this.pipelineConfig.id,
      status: 'running',
      startedAt: new Date(),
      steps: [],
      totalInputs: leads.length,
      totalOutputs: 0,
      errors: [],
      metadata: {},
    };

    logger.info(
      { runId, inputCount: leads.length },
      'Starting lead enrichment pipeline'
    );

    let currentLeads = [...leads];

    // Stage 1: Enrich with Apollo
    if (this.config.enrichFromApollo) {
      const enrichResult = await this.enrichWithApollo(currentLeads);
      run.steps.push(enrichResult.step);
      currentLeads = enrichResult.leads;

      if (enrichResult.step.status === 'failed') {
        run.errors.push(enrichResult.step.error ?? 'Apollo enrichment failed');
      }
    }

    // Stage 2: Verify emails
    if (this.config.verifyEmails) {
      const verifyResult = await this.verifyEmails(currentLeads);
      run.steps.push(verifyResult.step);
      currentLeads = verifyResult.leads;

      if (verifyResult.step.status === 'failed') {
        run.errors.push(verifyResult.step.error ?? 'Email verification failed');
      }
    }

    // Stage 3: Quality filter
    const filterResult = this.filterByQuality(currentLeads);
    run.steps.push(filterResult.step);
    currentLeads = filterResult.leads;

    // Complete the run
    run.status = run.errors.length > 0 ? 'failed' : 'completed';
    run.completedAt = new Date();
    run.totalOutputs = currentLeads.length;

    logger.info(
      {
        runId,
        inputCount: leads.length,
        outputCount: currentLeads.length,
        status: run.status,
      },
      'Lead enrichment pipeline completed'
    );

    return {
      enrichedLeads: currentLeads,
      run,
    };
  }

  private async enrichWithApollo(leads: Lead[]): Promise<{
    leads: Lead[];
    step: PipelineStepResult;
  }> {
    const startTime = Date.now();
    const enrichedLeads: Lead[] = [];

    try {
      for (const lead of leads) {
        if (lead.linkedinUrl) {
          const enrichedLead = await apollo.enrichPerson(lead.linkedinUrl);
          if (enrichedLead) {
            enrichedLeads.push({
              ...lead,
              ...enrichedLead,
              id: lead.id, // Keep original ID
              status: 'enriched',
              updatedAt: new Date(),
            });
          } else {
            enrichedLeads.push(lead);
          }
        } else {
          enrichedLeads.push(lead);
        }
      }

      return {
        leads: enrichedLeads,
        step: {
          stage: 'enrich',
          status: 'success',
          inputCount: leads.length,
          outputCount: enrichedLeads.length,
          duration: Date.now() - startTime,
          metadata: {
            enrichedCount: enrichedLeads.filter((l) => l.status === 'enriched').length,
          },
        },
      };
    } catch (error) {
      logger.error({ error }, 'Apollo enrichment failed');
      return {
        leads,
        step: {
          stage: 'enrich',
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

  private async verifyEmails(leads: Lead[]): Promise<{
    leads: Lead[];
    step: PipelineStepResult;
  }> {
    const startTime = Date.now();

    try {
      const emails = leads
        .filter((l) => l.email && !l.emailVerified)
        .map((l) => l.email!);

      if (emails.length === 0) {
        return {
          leads,
          step: {
            stage: 'verify',
            status: 'skipped',
            inputCount: leads.length,
            outputCount: leads.length,
            duration: Date.now() - startTime,
            metadata: { reason: 'No emails to verify' },
          },
        };
      }

      const results = await millionVerifier.verifyMultiple(emails);
      let verifiedCount = 0;

      const verifiedLeads = leads.map((lead) => {
        if (!lead.email) return lead;

        const result = results.get(lead.email);
        if (result?.isValid) {
          verifiedCount++;
          return {
            ...lead,
            emailVerified: true,
            status: lead.status === 'enriched' ? 'verified' : lead.status,
            updatedAt: new Date(),
          };
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

  private filterByQuality(leads: Lead[]): {
    leads: Lead[];
    step: PipelineStepResult;
  } {
    const startTime = Date.now();

    const filteredLeads = leads.filter((lead) => {
      // Must have email
      if (!lead.email) return false;

      // Prefer verified emails
      if (this.config.verifyEmails && !lead.emailVerified) return false;

      return true;
    });

    return {
      leads: filteredLeads,
      step: {
        stage: 'filter',
        status: 'success',
        inputCount: leads.length,
        outputCount: filteredLeads.length,
        duration: Date.now() - startTime,
        metadata: {
          filteredOut: leads.length - filteredLeads.length,
        },
      },
    };
  }
}

export function createLeadEnrichmentPipeline(
  config: LeadEnrichmentConfig
): LeadEnrichmentPipeline {
  return new LeadEnrichmentPipeline(config);
}
