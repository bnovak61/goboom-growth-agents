import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';
import { PainPoint } from '../types/campaign.types.js';

interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface PainPointResearchConfig {
  industry: string;
  targetAudience: string;
  product?: string;
  competitors?: string[];
  count?: number;
}

export class PerplexityClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.perplexity.ai',
        apiKey: apiKey ?? requireEnv('PERPLEXITY_API_KEY'),
        rateLimiter: defaultRateLimiters.perplexity(),
      },
      'perplexity'
    );
  }

  async chat(
    messages: PerplexityMessage[],
    model: string = 'llama-3.1-sonar-large-128k-online'
  ): Promise<string> {
    const response = await this.post<PerplexityResponse>('chat/completions', {
      model,
      messages,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async research(query: string): Promise<string> {
    return this.chat([
      {
        role: 'system',
        content:
          'You are a market research assistant. Provide detailed, factual information based on current data and trends.',
      },
      {
        role: 'user',
        content: query,
      },
    ]);
  }

  async researchPainPoints(config: PainPointResearchConfig): Promise<PainPoint[]> {
    const prompt = this.buildPainPointPrompt(config);

    const response = await this.chat([
      {
        role: 'system',
        content: `You are a market research expert specializing in customer pain points and frustrations.
Your job is to identify specific, emotionally resonant pain points that can be used in advertising copy.
Always respond with a JSON array of pain points.
Each pain point should be a specific frustration, not a generic statement.
Focus on emotional impact and relatability.`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    return this.parsePainPoints(response, config);
  }

  async researchCompetitorWeaknesses(
    competitors: string[],
    industry: string
  ): Promise<string[]> {
    const prompt = `Research the main customer complaints and weaknesses of these companies in the ${industry} industry:
${competitors.map((c) => `- ${c}`).join('\n')}

Focus on:
1. Common customer complaints from reviews
2. Feature gaps compared to alternatives
3. Pricing concerns
4. Service issues

Return a JSON array of specific weakness statements that could be used in competitive positioning.`;

    const response = await this.chat([
      {
        role: 'system',
        content:
          'You are a competitive intelligence analyst. Provide factual, sourced information about competitor weaknesses.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as string[];
      }
    } catch {
      this.logger.warn('Failed to parse competitor weaknesses JSON');
    }

    return response
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().match(/^\d+\./))
      .map((line) => line.replace(/^[-\d.]+\s*/, '').trim());
  }

  async generateAdCopy(
    painPoint: PainPoint,
    product: string,
    tone: 'professional' | 'casual' | 'urgent' = 'professional'
  ): Promise<{ headline: string; body: string; cta: string }> {
    const prompt = `Create Facebook ad copy for this pain point:
"${painPoint.text}"

Product/Service: ${product}
Tone: ${tone}

Return JSON with:
- headline: max 40 characters, attention-grabbing
- body: max 125 characters, addresses the pain point
- cta: call to action button text`;

    const response = await this.chat([
      {
        role: 'system',
        content:
          'You are an expert Facebook ads copywriter. Write compelling, conversion-focused ad copy.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      this.logger.warn('Failed to parse ad copy JSON');
    }

    return {
      headline: painPoint.text.slice(0, 40),
      body: `Stop struggling with ${painPoint.text.toLowerCase()}. Try ${product} today.`,
      cta: 'Learn More',
    };
  }

  private buildPainPointPrompt(config: PainPointResearchConfig): string {
    let prompt = `Research the top ${config.count ?? 10} pain points and frustrations of ${config.targetAudience} in the ${config.industry} industry.`;

    if (config.product) {
      prompt += `\n\nContext: These pain points should be relevant to someone considering ${config.product}.`;
    }

    if (config.competitors?.length) {
      prompt += `\n\nAlso consider pain points related to these competitors: ${config.competitors.join(', ')}`;
    }

    prompt += `\n\nReturn a JSON array with objects containing:
- text: the pain point statement (max 100 chars, written in first person like "I...")
- category: the category (e.g., "Time", "Money", "Frustration", "Trust")
- intensity: "low", "medium", or "high"

Example format:
[
  {"text": "I waste hours every week on manual data entry", "category": "Time", "intensity": "high"},
  {"text": "I can't trust the numbers in my reports", "category": "Trust", "intensity": "medium"}
]`;

    return prompt;
  }

  private parsePainPoints(
    response: string,
    config: PainPointResearchConfig
  ): PainPoint[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          text: string;
          category?: string;
          intensity?: 'low' | 'medium' | 'high';
        }>;

        return parsed.map((item) => ({
          id: uuid(),
          text: item.text,
          category: item.category,
          source: `perplexity:${config.industry}`,
          intensity: item.intensity,
          createdAt: new Date(),
        }));
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to parse pain points JSON');
    }

    // Fallback: extract bullet points
    const lines = response
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().match(/^\d+\./))
      .map((line) => line.replace(/^[-\d.]+\s*/, '').trim())
      .filter((line) => line.length > 10 && line.length < 150);

    return lines.map((text) => ({
      id: uuid(),
      text,
      source: `perplexity:${config.industry}`,
      createdAt: new Date(),
    }));
  }
}

// Helper to generate UUID without external dependency
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const perplexity = new PerplexityClient();
