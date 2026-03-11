import { createLogger } from '../../shared/utils/logger.js';
import { apollo, ApolloSearchParams } from '../../shared/clients/apollo.js';
import { phantomBuster } from '../../shared/clients/phantom-buster.js';
import { millionVerifier } from '../../shared/clients/million-verifier.js';
import { instantly } from '../../shared/clients/instantly.js';
import { notion, NotionPageCreate } from '../../shared/clients/notion.js';
import { Lead } from '../../shared/types/lead.types.js';

const logger = createLogger('icp-linkedin-crawler');

export interface ICPCriteria {
  titles: string[];
  industries?: string[];
  companySizes?: string[];
  locations?: string[];
  keywords?: string;
  excludeTitles?: string[];
  excludeCompanies?: string[];
}

export interface CrawlerConfig {
  icpCriteria: ICPCriteria;
  maxLeadsPerRun: number;
  instantlyCampaignId?: string;
  notionDatabaseId?: string;
  phantomProfileScraperAgentId?: string;
  verifyEmails?: boolean;
  enrichWithPhantom?: boolean;
}

export interface CrawlResult {
  leads: Lead[];
  totalFound: number;
  enrichedCount: number;
  verifiedCount: number;
  addedToInstantly: number;
  addedToNotion: number;
}

export class ICPLinkedInCrawler {
  private config: CrawlerConfig;
  private processedUrls: Set<string> = new Set();

  constructor(config: CrawlerConfig) {
    this.config = {
      verifyEmails: true,
      enrichWithPhantom: false,
      ...config,
    };
  }

  async crawl(): Promise<CrawlResult> {
    logger.info(
      { criteria: this.config.icpCriteria, maxLeads: this.config.maxLeadsPerRun },
      'Starting ICP LinkedIn crawl'
    );

    const result: CrawlResult = {
      leads: [],
      totalFound: 0,
      enrichedCount: 0,
      verifiedCount: 0,
      addedToInstantly: 0,
      addedToNotion: 0,
    };

    // Step 1: Search Apollo for matching profiles
    const apolloLeads = await this.searchApollo();
    result.totalFound = apolloLeads.length;
    logger.info({ count: apolloLeads.length }, 'Found leads from Apollo');

    // Step 2: Filter based on ICP criteria
    const filteredLeads = this.filterLeads(apolloLeads);
    logger.info({ count: filteredLeads.length }, 'Filtered leads');

    // Step 3: Optional PhantomBuster enrichment
    if (this.config.enrichWithPhantom && this.config.phantomProfileScraperAgentId) {
      await this.enrichWithPhantom(filteredLeads);
      result.enrichedCount = filteredLeads.filter((l) => l.metadata?.phantomEnriched).length;
    }

    // Step 4: Verify emails
    if (this.config.verifyEmails) {
      result.verifiedCount = await this.verifyEmails(filteredLeads);
    }

    // Get valid leads with verified emails
    const validLeads = filteredLeads.filter((l) => l.emailVerified && l.email);
    result.leads = validLeads;

    // Step 5: Add to Instantly
    if (this.config.instantlyCampaignId && validLeads.length > 0) {
      result.addedToInstantly = await this.addToInstantly(validLeads);
    }

    // Step 6: Add to Notion
    if (this.config.notionDatabaseId && validLeads.length > 0) {
      result.addedToNotion = await this.addToNotion(validLeads);
    }

    logger.info(
      {
        total: result.totalFound,
        enriched: result.enrichedCount,
        verified: result.verifiedCount,
        instantly: result.addedToInstantly,
        notion: result.addedToNotion,
      },
      'Crawl completed'
    );

    return result;
  }

  private async searchApollo(): Promise<Lead[]> {
    const { icpCriteria, maxLeadsPerRun } = this.config;
    const allLeads: Lead[] = [];
    let page = 1;
    const perPage = 25;

    while (allLeads.length < maxLeadsPerRun) {
      const searchParams: ApolloSearchParams = {
        personTitles: icpCriteria.titles,
        organizationIndustries: icpCriteria.industries,
        organizationNumEmployeesRanges: icpCriteria.companySizes,
        personLocations: icpCriteria.locations,
        qKeywords: icpCriteria.keywords,
        page,
        perPage,
      };

      const response = await apollo.searchPeople(searchParams);

      for (const person of response.people) {
        if (allLeads.length >= maxLeadsPerRun) break;

        // Skip if already processed
        if (person.linkedin_url && this.processedUrls.has(person.linkedin_url)) {
          continue;
        }

        const lead: Lead = {
          id: person.id,
          firstName: person.first_name,
          lastName: person.last_name,
          fullName: person.name,
          email: person.email,
          emailVerified: person.email_status === 'verified',
          linkedinUrl: person.linkedin_url,
          title: person.title,
          company: person.organization?.name,
          companyDomain: person.organization?.primary_domain,
          companySize: person.organization?.estimated_num_employees?.toString(),
          industry: person.organization?.industry,
          location: [person.city, person.state, person.country]
            .filter(Boolean)
            .join(', '),
          source: 'linkedin',
          sourceDetails: 'icp-crawler',
          status: 'new',
          tags: ['icp-match'],
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            apolloId: person.id,
          },
        };

        if (person.linkedin_url) {
          this.processedUrls.add(person.linkedin_url);
        }

        allLeads.push(lead);
      }

      if (page >= response.pagination.total_pages) break;
      page++;
    }

    return allLeads;
  }

  private filterLeads(leads: Lead[]): Lead[] {
    const { excludeTitles, excludeCompanies } = this.config.icpCriteria;

    return leads.filter((lead) => {
      // Filter out excluded titles
      if (excludeTitles?.length && lead.title) {
        const titleLower = lead.title.toLowerCase();
        const hasExcluded = excludeTitles.some((t) =>
          titleLower.includes(t.toLowerCase())
        );
        if (hasExcluded) return false;
      }

      // Filter out excluded companies
      if (excludeCompanies?.length && lead.company) {
        const companyLower = lead.company.toLowerCase();
        const hasExcluded = excludeCompanies.some((c) =>
          companyLower.includes(c.toLowerCase())
        );
        if (hasExcluded) return false;
      }

      // Must have email
      if (!lead.email) return false;

      return true;
    });
  }

  private async enrichWithPhantom(leads: Lead[]): Promise<void> {
    if (!this.config.phantomProfileScraperAgentId) return;

    for (const lead of leads) {
      if (!lead.linkedinUrl) continue;

      try {
        const profile = await phantomBuster.scrapeLinkedInProfile(
          lead.linkedinUrl,
          this.config.phantomProfileScraperAgentId
        );

        lead.metadata = {
          ...lead.metadata,
          phantomEnriched: true,
          about: profile.about,
          followers: profile.followers,
          connections: profile.connections,
        };

        // Update lead fields from Phantom data
        if (profile.headline && !lead.title) {
          lead.title = profile.headline;
        }
      } catch (error) {
        logger.warn(
          { linkedinUrl: lead.linkedinUrl, error },
          'Failed to enrich with PhantomBuster'
        );
      }
    }
  }

  private async verifyEmails(leads: Lead[]): Promise<number> {
    const emails = leads
      .filter((l) => l.email && !l.emailVerified)
      .map((l) => l.email!);

    if (emails.length === 0) return 0;

    const results = await millionVerifier.verifyMultiple(emails);
    let verifiedCount = 0;

    for (const lead of leads) {
      if (!lead.email) continue;

      const result = results.get(lead.email);
      if (result?.isValid) {
        lead.emailVerified = true;
        verifiedCount++;
      }
    }

    return verifiedCount;
  }

  private async addToInstantly(leads: Lead[]): Promise<number> {
    if (!this.config.instantlyCampaignId) return 0;

    const result = await instantly.addLeadsToCampaign(
      this.config.instantlyCampaignId,
      leads
    );

    return result.uploaded ?? 0;
  }

  private async addToNotion(leads: Lead[]): Promise<number> {
    if (!this.config.notionDatabaseId) return 0;

    let addedCount = 0;

    for (const lead of leads) {
      try {
        const pageCreate: NotionPageCreate = {
          parentDatabaseId: this.config.notionDatabaseId,
          properties: {
            Name: { title: lead.fullName ?? '' },
            Email: { email: lead.email ?? '' },
            Company: { rich_text: lead.company ?? '' },
            Title: { rich_text: lead.title ?? '' },
            LinkedIn: { url: lead.linkedinUrl ?? '' },
            Industry: { select: lead.industry ?? 'Unknown' },
            Status: { select: 'New' },
            Source: { select: 'ICP Crawler' },
          },
        };

        await notion.createPage(pageCreate);
        addedCount++;
      } catch (error) {
        logger.warn({ leadId: lead.id, error }, 'Failed to add lead to Notion');
      }
    }

    return addedCount;
  }

  // Allow updating processed URLs from external storage
  setProcessedUrls(urls: string[]): void {
    this.processedUrls = new Set(urls);
  }

  getProcessedUrls(): string[] {
    return Array.from(this.processedUrls);
  }
}

export function createICPCrawler(config: CrawlerConfig): ICPLinkedInCrawler {
  return new ICPLinkedInCrawler(config);
}
