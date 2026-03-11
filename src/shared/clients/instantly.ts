import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';
import { Lead } from '../types/lead.types.js';

interface InstantlyCampaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  personalization?: string;
  phone?: string;
  website?: string;
  custom_variables?: Record<string, string>;
}

interface InstantlyLeadResponse {
  status: string;
  message?: string;
  uploaded?: number;
  failed?: number;
}

interface InstantlyAnalytics {
  campaign_id: string;
  total_leads: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

export class InstantlyClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.instantly.ai/api/v1',
        rateLimiter: defaultRateLimiters.instantly(),
      },
      'instantly'
    );
    this.apiKey = apiKey ?? requireEnv('INSTANTLY_API_KEY');
  }

  private apiKey: string;

  private appendApiKey(path: string): string {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}api_key=${this.apiKey}`;
  }

  async listCampaigns(): Promise<InstantlyCampaign[]> {
    const response = await this.get<InstantlyCampaign[]>(
      this.appendApiKey('campaign/list')
    );
    return response;
  }

  async getCampaign(campaignId: string): Promise<InstantlyCampaign> {
    const response = await this.get<InstantlyCampaign>(
      this.appendApiKey(`campaign/get?campaign_id=${campaignId}`)
    );
    return response;
  }

  async addLeadsToCampaign(
    campaignId: string,
    leads: Lead[]
  ): Promise<InstantlyLeadResponse> {
    const instantlyLeads: InstantlyLead[] = leads
      .filter((lead) => lead.email)
      .map((lead) => ({
        email: lead.email!,
        first_name: lead.firstName,
        last_name: lead.lastName,
        company_name: lead.company,
        phone: lead.phone,
        website: lead.companyDomain,
        custom_variables: {
          linkedin_url: lead.linkedinUrl ?? '',
          title: lead.title ?? '',
          source: lead.source,
        },
      }));

    const response = await this.post<InstantlyLeadResponse>(
      this.appendApiKey('lead/add'),
      {
        campaign_id: campaignId,
        skip_if_in_workspace: true,
        leads: instantlyLeads,
      }
    );

    return response;
  }

  async addSingleLead(
    campaignId: string,
    lead: Lead
  ): Promise<InstantlyLeadResponse> {
    return this.addLeadsToCampaign(campaignId, [lead]);
  }

  async getCampaignAnalytics(campaignId: string): Promise<InstantlyAnalytics> {
    const response = await this.get<InstantlyAnalytics>(
      this.appendApiKey(`analytics/campaign/summary?campaign_id=${campaignId}`)
    );
    return response;
  }

  async getCampaignLeads(
    campaignId: string,
    limit: number = 100,
    skip: number = 0
  ): Promise<InstantlyLead[]> {
    const response = await this.get<InstantlyLead[]>(
      this.appendApiKey(
        `lead/list?campaign_id=${campaignId}&limit=${limit}&skip=${skip}`
      )
    );
    return response;
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.post(this.appendApiKey('campaign/pause'), {
      campaign_id: campaignId,
    });
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.post(this.appendApiKey('campaign/resume'), {
      campaign_id: campaignId,
    });
  }

  async deleteLead(campaignId: string, email: string): Promise<void> {
    await this.post(this.appendApiKey('lead/delete'), {
      campaign_id: campaignId,
      email,
    });
  }
}

export const instantly = new InstantlyClient();
