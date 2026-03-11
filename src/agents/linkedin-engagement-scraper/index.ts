import { createLogger } from '../../shared/utils/logger.js';
import { phantomBuster } from '../../shared/clients/phantom-buster.js';
import { apollo } from '../../shared/clients/apollo.js';
import { millionVerifier } from '../../shared/clients/million-verifier.js';
import { instantly } from '../../shared/clients/instantly.js';
import { slack } from '../../shared/clients/slack.js';
import { Lead, LinkedInEngagement } from '../../shared/types/lead.types.js';

const logger = createLogger('linkedin-engagement-scraper');

export interface EngagementScraperConfig {
  phantomAgentId: string;
  instantlyCampaignId: string;
  slackChannelId?: string;
  filterOptions?: {
    engagementTypes?: ('like' | 'comment' | 'share' | 'reaction')[];
    minConnections?: number;
    requiredKeywords?: string[];
    excludeKeywords?: string[];
    requiredTitles?: string[];
  };
  verifyEmails?: boolean;
}

export interface ScrapedLead {
  engagement: LinkedInEngagement;
  lead: Lead;
  enriched: boolean;
  emailVerified: boolean;
}

export class LinkedInEngagementScraper {
  private config: EngagementScraperConfig;

  constructor(config: EngagementScraperConfig) {
    this.config = {
      verifyEmails: true,
      ...config,
    };
  }

  async processPost(postUrl: string): Promise<{
    leads: ScrapedLead[];
    enrichedCount: number;
    verifiedCount: number;
    addedToInstantly: number;
  }> {
    logger.info({ postUrl }, 'Processing LinkedIn post for engagements');

    // Step 1: Scrape engagements
    const engagements = await this.scrapeEngagements(postUrl);
    logger.info({ count: engagements.length }, 'Scraped engagements');

    // Step 2: Filter based on criteria
    const filteredEngagements = this.filterEngagements(engagements);
    logger.info({ count: filteredEngagements.length }, 'Filtered engagements');

    // Step 3: Enrich with Apollo
    const leads = await this.enrichLeads(filteredEngagements);
    const enrichedCount = leads.filter((l) => l.enriched).length;
    logger.info({ enriched: enrichedCount }, 'Enriched leads');

    // Step 4: Verify emails
    let verifiedCount = 0;
    if (this.config.verifyEmails) {
      verifiedCount = await this.verifyEmails(leads);
      logger.info({ verified: verifiedCount }, 'Verified emails');
    }

    // Step 5: Add to Instantly
    const validLeads = leads.filter((l) => l.emailVerified && l.lead.email);
    const addedToInstantly = await this.addToInstantly(validLeads);
    logger.info({ added: addedToInstantly }, 'Added to Instantly');

    // Step 6: Send notification
    if (this.config.slackChannelId) {
      await this.sendNotification(postUrl, leads, enrichedCount, verifiedCount, addedToInstantly);
    }

    return {
      leads: validLeads,
      enrichedCount,
      verifiedCount,
      addedToInstantly,
    };
  }

  private async scrapeEngagements(postUrl: string): Promise<LinkedInEngagement[]> {
    return phantomBuster.scrapePostEngagements(postUrl, this.config.phantomAgentId);
  }

  private filterEngagements(engagements: LinkedInEngagement[]): LinkedInEngagement[] {
    const { filterOptions } = this.config;
    if (!filterOptions) return engagements;

    return engagements.filter((engagement) => {
      const { profile, engagementType, commentText } = engagement;

      // Filter by engagement type
      if (
        filterOptions.engagementTypes &&
        !filterOptions.engagementTypes.includes(engagementType)
      ) {
        return false;
      }

      // Filter by connections
      if (
        filterOptions.minConnections &&
        profile.connections &&
        profile.connections < filterOptions.minConnections
      ) {
        return false;
      }

      // Filter by title keywords
      if (filterOptions.requiredTitles?.length) {
        const title = (profile.title ?? profile.headline ?? '').toLowerCase();
        const hasRequiredTitle = filterOptions.requiredTitles.some((t) =>
          title.includes(t.toLowerCase())
        );
        if (!hasRequiredTitle) return false;
      }

      // Filter by required keywords in headline/title
      if (filterOptions.requiredKeywords?.length) {
        const text = `${profile.headline ?? ''} ${profile.title ?? ''} ${
          commentText ?? ''
        }`.toLowerCase();
        const hasKeyword = filterOptions.requiredKeywords.some((k) =>
          text.includes(k.toLowerCase())
        );
        if (!hasKeyword) return false;
      }

      // Filter out excluded keywords
      if (filterOptions.excludeKeywords?.length) {
        const text = `${profile.headline ?? ''} ${profile.title ?? ''} ${
          commentText ?? ''
        }`.toLowerCase();
        const hasExcluded = filterOptions.excludeKeywords.some((k) =>
          text.includes(k.toLowerCase())
        );
        if (hasExcluded) return false;
      }

      return true;
    });
  }

  private async enrichLeads(engagements: LinkedInEngagement[]): Promise<ScrapedLead[]> {
    const leads: ScrapedLead[] = [];

    for (const engagement of engagements) {
      const { profile } = engagement;

      // Try to enrich with Apollo
      let enrichedLead: Lead | null = null;
      let enriched = false;

      if (profile.profileUrl) {
        enrichedLead = await apollo.enrichPerson(profile.profileUrl);
        if (enrichedLead) {
          enriched = true;
        }
      }

      // Create lead from engagement data if not enriched
      const lead: Lead = enrichedLead ?? {
        id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        firstName: profile.firstName,
        lastName: profile.lastName,
        fullName: `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim(),
        linkedinUrl: profile.profileUrl,
        title: profile.title,
        company: profile.company,
        emailVerified: false,
        source: 'linkedin',
        sourceDetails: `engagement:${engagement.engagementType}`,
        status: enriched ? 'enriched' : 'new',
        tags: ['linkedin-engagement'],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          engagementType: engagement.engagementType,
          headline: profile.headline,
        },
      };

      leads.push({
        engagement,
        lead,
        enriched,
        emailVerified: false,
      });
    }

    return leads;
  }

  private async verifyEmails(leads: ScrapedLead[]): Promise<number> {
    const emails = leads
      .filter((l) => l.lead.email)
      .map((l) => l.lead.email!);

    if (emails.length === 0) return 0;

    const results = await millionVerifier.verifyMultiple(emails);
    let verifiedCount = 0;

    for (const lead of leads) {
      if (!lead.lead.email) continue;

      const result = results.get(lead.lead.email);
      if (result?.isValid) {
        lead.emailVerified = true;
        lead.lead.emailVerified = true;
        verifiedCount++;
      }
    }

    return verifiedCount;
  }

  private async addToInstantly(leads: ScrapedLead[]): Promise<number> {
    if (leads.length === 0) return 0;

    const instantlyLeads = leads.map((l) => l.lead);
    const result = await instantly.addLeadsToCampaign(
      this.config.instantlyCampaignId,
      instantlyLeads
    );

    return result.uploaded ?? 0;
  }

  private async sendNotification(
    postUrl: string,
    leads: ScrapedLead[],
    enrichedCount: number,
    verifiedCount: number,
    addedCount: number
  ): Promise<void> {
    if (!this.config.slackChannelId) return;

    await slack.postMessage({
      channel: this.config.slackChannelId,
      text: `LinkedIn Engagement Scraper completed`,
      blocks: [
        slack.createMetricsBlock('LinkedIn Engagement Scraper', {
          'Total Engagements': leads.length,
          'Enriched': enrichedCount,
          'Verified': verifiedCount,
          'Added to Instantly': addedCount,
        }),
      ],
      attachments: [
        slack.createAlertBlock(
          'Post Processed',
          postUrl,
          addedCount > 0 ? 'good' : 'warning'
        ),
      ],
    });
  }
}

export function createEngagementScraper(
  config: EngagementScraperConfig
): LinkedInEngagementScraper {
  return new LinkedInEngagementScraper(config);
}

// Slack trigger handler for webhook
export async function handleSlackTrigger(
  payload: { text: string; channel: string; user: string },
  config: EngagementScraperConfig
): Promise<void> {
  const postUrlMatch = payload.text.match(
    /https:\/\/www\.linkedin\.com\/(?:feed\/update|posts)\/[^\s]+/
  );

  if (!postUrlMatch) {
    await slack.postMessage({
      channel: payload.channel,
      text: 'Please provide a valid LinkedIn post URL',
    });
    return;
  }

  const postUrl = postUrlMatch[0];
  const scraper = new LinkedInEngagementScraper({
    ...config,
    slackChannelId: payload.channel,
  });

  await slack.postMessage({
    channel: payload.channel,
    text: `Starting to scrape engagements from: ${postUrl}`,
  });

  await scraper.processPost(postUrl);
}
