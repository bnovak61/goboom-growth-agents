import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';
import { LinkedInProfile, LinkedInEngagement } from '../types/lead.types.js';

interface PhantomAgent {
  id: string;
  name: string;
  scriptId: string;
  lastEndedAt: string;
  lastEndStatus: string;
}

interface PhantomLaunchResult {
  containerId: string;
  status: string;
}

interface PhantomOutput {
  containerId: string;
  status: string;
  output?: unknown;
  resultObject?: unknown;
}

export class PhantomBusterClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.phantombuster.com/api/v2',
        apiKey: apiKey ?? requireEnv('PHANTOM_BUSTER_API_KEY'),
        rateLimiter: defaultRateLimiters.phantomBuster(),
        headers: {
          'X-Phantombuster-Key': apiKey ?? requireEnv('PHANTOM_BUSTER_API_KEY'),
        },
      },
      'phantom-buster'
    );
  }

  async listAgents(): Promise<PhantomAgent[]> {
    const response = await this.get<{ data: PhantomAgent[] }>('agents/fetch-all');
    return response.data;
  }

  async getAgent(agentId: string): Promise<PhantomAgent> {
    const response = await this.get<PhantomAgent>(`agents/fetch?id=${agentId}`);
    return response;
  }

  async launchAgent(
    agentId: string,
    argument?: Record<string, unknown>
  ): Promise<PhantomLaunchResult> {
    const response = await this.post<PhantomLaunchResult>('agents/launch', {
      id: agentId,
      argument: argument ? JSON.stringify(argument) : undefined,
    });
    return response;
  }

  async getAgentOutput(agentId: string): Promise<PhantomOutput> {
    const response = await this.get<PhantomOutput>(
      `agents/fetch-output?id=${agentId}`
    );
    return response;
  }

  async waitForCompletion(
    containerId: string,
    maxWaitMs: number = 300000,
    pollIntervalMs: number = 5000
  ): Promise<PhantomOutput> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const output = await this.get<PhantomOutput>(
        `containers/fetch-output?id=${containerId}`
      );

      if (output.status === 'finished' || output.status === 'error') {
        return output;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Phantom execution timed out after ${maxWaitMs}ms`);
  }

  async scrapeLinkedInProfile(profileUrl: string, agentId: string): Promise<LinkedInProfile> {
    const launchResult = await this.launchAgent(agentId, {
      sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
      profileUrls: [profileUrl],
    });

    const output = await this.waitForCompletion(launchResult.containerId);

    if (!output.resultObject || !Array.isArray(output.resultObject)) {
      throw new Error('Invalid PhantomBuster response');
    }

    const profile = output.resultObject[0] as Record<string, unknown>;

    return {
      profileUrl,
      firstName: profile.firstName as string,
      lastName: profile.lastName as string,
      headline: profile.headline as string,
      title: profile.title as string,
      company: profile.company as string,
      location: profile.location as string,
      connectionDegree: profile.connectionDegree as string,
      profileImageUrl: profile.profileImageUrl as string,
      about: profile.about as string,
    };
  }

  async scrapePostEngagements(
    postUrl: string,
    agentId: string
  ): Promise<LinkedInEngagement[]> {
    const launchResult = await this.launchAgent(agentId, {
      sessionCookie: process.env.LINKEDIN_SESSION_COOKIE,
      postUrl,
    });

    const output = await this.waitForCompletion(launchResult.containerId);

    if (!output.resultObject || !Array.isArray(output.resultObject)) {
      throw new Error('Invalid PhantomBuster response');
    }

    return (output.resultObject as Record<string, unknown>[]).map((item) => ({
      postUrl,
      engagementType: (item.type as 'like' | 'comment' | 'share' | 'reaction') ?? 'like',
      profile: {
        profileUrl: item.profileUrl as string,
        firstName: item.firstName as string,
        lastName: item.lastName as string,
        headline: item.headline as string,
        title: item.title as string,
        company: item.company as string,
      },
      commentText: item.commentText as string | undefined,
      reactionType: item.reactionType as string | undefined,
    }));
  }
}

export const phantomBuster = new PhantomBusterClient();
