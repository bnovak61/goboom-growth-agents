import pRetry, { AbortError } from 'p-retry';
import { createLogger } from './logger.js';

const logger = createLogger('retry');

export interface RetryConfig {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  factor?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

const defaultConfig: Required<Omit<RetryConfig, 'onRetry'>> = {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 30000,
  factor: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const mergedConfig = { ...defaultConfig, ...config };

  return pRetry(fn, {
    retries: mergedConfig.retries,
    minTimeout: mergedConfig.minTimeout,
    maxTimeout: mergedConfig.maxTimeout,
    factor: mergedConfig.factor,
    onFailedAttempt: (error) => {
      logger.warn(
        {
          attempt: error.attemptNumber,
          retriesLeft: error.retriesLeft,
          error: error.message,
        },
        'Retry attempt failed'
      );

      if (config.onRetry) {
        config.onRetry(error, error.attemptNumber);
      }
    },
  });
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors
    if (error.message.includes('ECONNRESET')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('ENOTFOUND')) return true;
    if (error.message.includes('ECONNREFUSED')) return true;

    // HTTP errors that are retryable
    if (error.message.includes('429')) return true; // Rate limited
    if (error.message.includes('500')) return true; // Server error
    if (error.message.includes('502')) return true; // Bad gateway
    if (error.message.includes('503')) return true; // Service unavailable
    if (error.message.includes('504')) return true; // Gateway timeout
  }

  return false;
}

export function abortRetry(error: Error): never {
  throw new AbortError(error.message);
}

export { AbortError };
