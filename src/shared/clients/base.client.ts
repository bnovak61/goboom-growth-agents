import ky, { KyInstance, Options } from 'ky';
import { RateLimiter } from '../utils/rate-limiter.js';
import { withRetry, RetryConfig } from '../utils/retry.js';
import { createLogger, Logger } from '../utils/logger.js';

export interface BaseClientConfig {
  baseUrl: string;
  apiKey?: string;
  rateLimiter?: RateLimiter;
  retryConfig?: RetryConfig;
  headers?: Record<string, string>;
  timeout?: number;
}

export abstract class BaseClient {
  protected readonly client: KyInstance;
  protected readonly rateLimiter?: RateLimiter;
  protected readonly retryConfig: RetryConfig;
  protected readonly logger: Logger;

  constructor(config: BaseClientConfig, clientName: string) {
    this.logger = createLogger(clientName);
    this.rateLimiter = config.rateLimiter;
    this.retryConfig = config.retryConfig ?? { retries: 3 };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    this.client = ky.create({
      prefixUrl: config.baseUrl,
      headers,
      timeout: config.timeout ?? 30000,
      hooks: {
        beforeRequest: [
          async () => {
            if (this.rateLimiter) {
              await this.rateLimiter.waitForSlot();
            }
          },
        ],
        afterResponse: [
          (_request, _options, response) => {
            this.logger.debug(
              {
                url: response.url,
                status: response.status,
              },
              'API response'
            );
            return response;
          },
        ],
      },
    });
  }

  protected async request<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    options?: Options
  ): Promise<T> {
    return withRetry(
      async () => {
        const response = await this.client[method](path, options);
        return response.json<T>();
      },
      this.retryConfig
    );
  }

  protected async get<T>(path: string, options?: Options): Promise<T> {
    return this.request<T>('get', path, options);
  }

  protected async post<T>(path: string, body?: unknown, options?: Options): Promise<T> {
    return this.request<T>('post', path, { ...options, json: body });
  }

  protected async put<T>(path: string, body?: unknown, options?: Options): Promise<T> {
    return this.request<T>('put', path, { ...options, json: body });
  }

  protected async patch<T>(path: string, body?: unknown, options?: Options): Promise<T> {
    return this.request<T>('patch', path, { ...options, json: body });
  }

  protected async delete<T>(path: string, options?: Options): Promise<T> {
    return this.request<T>('delete', path, options);
  }
}
