import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';
import { Lead } from '../types/lead.types.js';

interface ApolloPersonMatch {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  linkedin_url: string;
  title: string;
  email_status: string;
  email: string;
  organization_id: string;
  organization: {
    id: string;
    name: string;
    website_url: string;
    primary_domain: string;
    industry: string;
    estimated_num_employees: number;
  };
  city: string;
  state: string;
  country: string;
}

interface ApolloSearchResponse {
  people: ApolloPersonMatch[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

interface ApolloEnrichResponse {
  person: ApolloPersonMatch;
}

export interface ApolloSearchParams {
  personTitles?: string[];
  personLocations?: string[];
  organizationIndustries?: string[];
  organizationNumEmployeesRanges?: string[];
  organizationLocations?: string[];
  qKeywords?: string;
  page?: number;
  perPage?: number;
}

export class ApolloClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.apollo.io/v1',
        apiKey: apiKey ?? requireEnv('APOLLO_API_KEY'),
        rateLimiter: defaultRateLimiters.apollo(),
      },
      'apollo'
    );
  }

  async searchPeople(params: ApolloSearchParams): Promise<ApolloSearchResponse> {
    const body = {
      person_titles: params.personTitles,
      person_locations: params.personLocations,
      organization_industry_tag_ids: params.organizationIndustries,
      organization_num_employees_ranges: params.organizationNumEmployeesRanges,
      organization_locations: params.organizationLocations,
      q_keywords: params.qKeywords,
      page: params.page ?? 1,
      per_page: params.perPage ?? 25,
    };

    return this.post<ApolloSearchResponse>('mixed_people/search', body);
  }

  async enrichPerson(linkedinUrl: string): Promise<Lead | null> {
    try {
      const response = await this.post<ApolloEnrichResponse>('people/match', {
        linkedin_url: linkedinUrl,
        reveal_personal_emails: false,
      });

      if (!response.person) {
        return null;
      }

      const person = response.person;

      return {
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
        status: 'enriched',
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          apolloId: person.id,
          organizationId: person.organization_id,
        },
      };
    } catch (error) {
      this.logger.warn({ linkedinUrl, error }, 'Failed to enrich person');
      return null;
    }
  }

  async enrichMultiple(linkedinUrls: string[]): Promise<Map<string, Lead | null>> {
    const results = new Map<string, Lead | null>();

    for (const url of linkedinUrls) {
      const lead = await this.enrichPerson(url);
      results.set(url, lead);
    }

    return results;
  }

  async getOrganization(domain: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.post<{ organization: Record<string, unknown> }>(
        'organizations/enrich',
        { domain }
      );
      return response.organization;
    } catch {
      return null;
    }
  }
}

export const apollo = new ApolloClient();
