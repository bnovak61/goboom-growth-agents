import { createLogger } from '../../shared/utils/logger.js';
import { rephonic, Podcast, PodcastHost } from '../../shared/clients/rephonic.js';
import { millionVerifier } from '../../shared/clients/million-verifier.js';
import { instantly } from '../../shared/clients/instantly.js';
import { Lead } from '../../shared/types/lead.types.js';

const logger = createLogger('podcast-outreach');

export interface PodcastOutreachConfig {
  niche: string;
  minListenScore?: number;
  maxPodcasts?: number;
  instantlyCampaignId: string;
  emailTemplate: {
    subject: string;
    body: string;
  };
  verifyEmails?: boolean;
}

export interface PodcastProspect {
  podcast: Podcast;
  host: PodcastHost;
  lead: Lead;
  emailVerified: boolean;
}

export class PodcastOutreachPipeline {
  private config: PodcastOutreachConfig;

  constructor(config: PodcastOutreachConfig) {
    this.config = {
      minListenScore: 30,
      maxPodcasts: 50,
      verifyEmails: true,
      ...config,
    };
  }

  async run(): Promise<{
    prospects: PodcastProspect[];
    addedToInstantly: number;
    emailsVerified: number;
  }> {
    logger.info({ config: this.config }, 'Starting podcast outreach pipeline');

    // Step 1: Find podcasts in niche
    const podcasts = await this.findPodcasts();
    logger.info({ count: podcasts.length }, 'Found podcasts');

    // Step 2: Get hosts with contact info
    const prospects = await this.getProspectsWithContacts(podcasts);
    logger.info({ count: prospects.length }, 'Found prospects with contact info');

    // Step 3: Verify emails
    let emailsVerified = 0;
    if (this.config.verifyEmails) {
      emailsVerified = await this.verifyEmails(prospects);
      logger.info({ verified: emailsVerified }, 'Verified emails');
    }

    // Step 4: Add to Instantly campaign
    const validProspects = prospects.filter((p) => p.emailVerified);
    const addedToInstantly = await this.addToInstantly(validProspects);
    logger.info({ added: addedToInstantly }, 'Added to Instantly');

    return {
      prospects: validProspects,
      addedToInstantly,
      emailsVerified,
    };
  }

  private async findPodcasts(): Promise<Podcast[]> {
    return rephonic.findPodcastsInNiche(
      this.config.niche,
      this.config.minListenScore,
      this.config.maxPodcasts
    );
  }

  private async getProspectsWithContacts(
    podcasts: Podcast[]
  ): Promise<PodcastProspect[]> {
    const prospects: PodcastProspect[] = [];

    for (const podcast of podcasts) {
      try {
        const hosts = await rephonic.getPodcastHosts(podcast.id);

        for (const host of hosts) {
          if (!host.email) continue;

          const lead: Lead = {
            id: `podcast-${podcast.id}-${host.id}`,
            firstName: host.name.split(' ')[0],
            lastName: host.name.split(' ').slice(1).join(' '),
            fullName: host.name,
            email: host.email,
            emailVerified: false,
            linkedinUrl: host.linkedinUrl,
            title: `${host.role} at ${podcast.title}`,
            company: podcast.publisher,
            source: 'podcast',
            sourceDetails: podcast.title,
            status: 'new',
            tags: ['podcast', this.config.niche],
            metadata: {
              podcastId: podcast.id,
              podcastTitle: podcast.title,
              listenScore: podcast.listenScore,
              hostRole: host.role,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          prospects.push({
            podcast,
            host,
            lead,
            emailVerified: false,
          });
        }
      } catch (error) {
        logger.warn({ podcastId: podcast.id, error }, 'Failed to get hosts');
      }
    }

    return prospects;
  }

  private async verifyEmails(prospects: PodcastProspect[]): Promise<number> {
    const emails = prospects
      .map((p) => p.lead.email)
      .filter((e): e is string => !!e);

    if (emails.length === 0) return 0;

    const verificationResults = await millionVerifier.verifyMultiple(emails);
    let verifiedCount = 0;

    for (const prospect of prospects) {
      if (!prospect.lead.email) continue;

      const result = verificationResults.get(prospect.lead.email);
      if (result?.isValid) {
        prospect.emailVerified = true;
        prospect.lead.emailVerified = true;
        verifiedCount++;
      }
    }

    return verifiedCount;
  }

  private async addToInstantly(prospects: PodcastProspect[]): Promise<number> {
    if (prospects.length === 0) return 0;

    const leads = prospects.map((p) => p.lead);
    const result = await instantly.addLeadsToCampaign(
      this.config.instantlyCampaignId,
      leads
    );

    return result.uploaded ?? 0;
  }

  generatePersonalizedEmail(prospect: PodcastProspect): {
    subject: string;
    body: string;
  } {
    const { lead, podcast } = prospect;

    const subject = this.config.emailTemplate.subject
      .replace('{firstName}', lead.firstName ?? '')
      .replace('{podcastName}', podcast.title)
      .replace('{niche}', this.config.niche);

    const body = this.config.emailTemplate.body
      .replace('{firstName}', lead.firstName ?? '')
      .replace('{podcastName}', podcast.title)
      .replace('{niche}', this.config.niche)
      .replace('{listenScore}', podcast.listenScore.toString())
      .replace('{totalEpisodes}', podcast.totalEpisodes.toString());

    return { subject, body };
  }
}

export function createPodcastOutreach(
  config: PodcastOutreachConfig
): PodcastOutreachPipeline {
  return new PodcastOutreachPipeline(config);
}
