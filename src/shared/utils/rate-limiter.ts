import { createLogger } from './logger.js';

const logger = createLogger('rate-limiter');

interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  name?: string;
}

interface RequestRecord {
  timestamp: number;
}

export class RateLimiter {
  private requests: RequestRecord[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly name: string;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
    this.name = config.name ?? 'default';
  }

  private cleanOldRequests(): void {
    const now = Date.now();
    this.requests = this.requests.filter(
      (req) => now - req.timestamp < this.windowMs
    );
  }

  async waitForSlot(): Promise<void> {
    this.cleanOldRequests();

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (Date.now() - oldestRequest.timestamp);

      if (waitTime > 0) {
        logger.debug(
          { limiter: this.name, waitTime },
          'Rate limit reached, waiting'
        );
        await this.sleep(waitTime);
        this.cleanOldRequests();
      }
    }

    this.requests.push({ timestamp: Date.now() });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStatus(): { current: number; max: number; resetIn: number } {
    this.cleanOldRequests();
    const resetIn =
      this.requests.length > 0
        ? this.windowMs - (Date.now() - this.requests[0].timestamp)
        : 0;

    return {
      current: this.requests.length,
      max: this.maxRequests,
      resetIn: Math.max(0, resetIn),
    };
  }
}

const limiters = new Map<string, RateLimiter>();

export function getRateLimiter(name: string, config: Omit<RateLimiterConfig, 'name'>): RateLimiter {
  const existing = limiters.get(name);
  if (existing) return existing;

  const limiter = new RateLimiter({ ...config, name });
  limiters.set(name, limiter);
  return limiter;
}

export const defaultRateLimiters = {
  phantomBuster: () => getRateLimiter('phantom-buster', { maxRequests: 10, windowMs: 60000 }),
  apollo: () => getRateLimiter('apollo', { maxRequests: 50, windowMs: 60000 }),
  instantly: () => getRateLimiter('instantly', { maxRequests: 100, windowMs: 60000 }),
  millionVerifier: () => getRateLimiter('million-verifier', { maxRequests: 100, windowMs: 60000 }),
  facebook: () => getRateLimiter('facebook', { maxRequests: 200, windowMs: 3600000 }),
  notion: () => getRateLimiter('notion', { maxRequests: 3, windowMs: 1000 }),
  perplexity: () => getRateLimiter('perplexity', { maxRequests: 20, windowMs: 60000 }),
  rephonic: () => getRateLimiter('rephonic', { maxRequests: 30, windowMs: 60000 }),
  slack: () => getRateLimiter('slack', { maxRequests: 50, windowMs: 60000 }),
  anthropic: () => getRateLimiter('anthropic', { maxRequests: 50, windowMs: 60000 }),
};
