import Anthropic from '@anthropic-ai/sdk';
import { getEnv, requireEnv } from '../../config/index.js';
import { createLogger } from '../utils/logger.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';

const logger = createLogger('anthropic-client');

export class AnthropicClient {
  private client: Anthropic;
  private rateLimiter: ReturnType<typeof defaultRateLimiters.anthropic>;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? requireEnv('ANTHROPIC_API_KEY'),
    });
    this.rateLimiter = defaultRateLimiters.anthropic();
  }

  static createIfConfigured(): AnthropicClient | null {
    const key = getEnv('ANTHROPIC_API_KEY');
    if (!key) return null;
    return new AnthropicClient(key);
  }

  async message(
    systemPrompt: string,
    userMessage: string,
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    await this.rateLimiter.waitForSlot();

    const model = options?.model ?? 'claude-sonnet-4-20250514';
    const maxTokens = options?.maxTokens ?? 4096;

    logger.debug({ model, maxTokens }, 'Sending message to Claude');

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: options?.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const text = textBlock && 'text' in textBlock ? textBlock.text : '';

    logger.debug(
      {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      'Claude response received'
    );

    return text;
  }

  async messageJson<T>(
    systemPrompt: string,
    userMessage: string,
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<T> {
    const response = await this.message(
      systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no code fences, no extra text.',
      userMessage,
      options
    );

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = response.match(/[\[{][\s\S]*[\]}]/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse JSON from Claude response: ${response.slice(0, 200)}`);
    }

    return JSON.parse(jsonMatch[0]) as T;
  }
}

// No eager singleton — create instances via `new AnthropicClient()` or `AnthropicClient.createIfConfigured()`
