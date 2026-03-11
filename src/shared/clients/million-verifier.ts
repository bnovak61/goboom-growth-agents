import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';

export type EmailVerificationResult =
  | 'ok'
  | 'catch_all'
  | 'unknown'
  | 'invalid'
  | 'disposable'
  | 'spam_trap';

interface SingleVerifyResponse {
  email: string;
  quality: string;
  result: EmailVerificationResult;
  resultcode: number;
  subresult: string;
  free: boolean;
  role: boolean;
  didyoumean: string | null;
  credits: number;
  executiontime: number;
}

interface BulkUploadResponse {
  file_id: string;
  status: string;
}

interface BulkStatusResponse {
  file_id: string;
  status: 'processing' | 'completed' | 'failed';
  percent: number;
  total: number;
  verified: number;
  ok: number;
  catch_all: number;
  unknown: number;
  invalid: number;
  disposable: number;
}

export interface VerifiedEmail {
  email: string;
  result: EmailVerificationResult;
  isValid: boolean;
  isRisky: boolean;
  isFree: boolean;
  isRole: boolean;
  suggestedEmail: string | null;
}

export class MillionVerifierClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.millionverifier.com/api/v3',
        rateLimiter: defaultRateLimiters.millionVerifier(),
      },
      'million-verifier'
    );
    this.apiKey = apiKey ?? requireEnv('MILLION_VERIFIER_API_KEY');
  }

  private apiKey: string;

  async verifySingle(email: string): Promise<VerifiedEmail> {
    const response = await this.get<SingleVerifyResponse>(
      `?api=${this.apiKey}&email=${encodeURIComponent(email)}`
    );

    return {
      email: response.email,
      result: response.result,
      isValid: response.result === 'ok',
      isRisky: ['catch_all', 'unknown'].includes(response.result),
      isFree: response.free,
      isRole: response.role,
      suggestedEmail: response.didyoumean,
    };
  }

  async verifyMultiple(emails: string[]): Promise<Map<string, VerifiedEmail>> {
    const results = new Map<string, VerifiedEmail>();

    // Process in batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const promises = batch.map((email) => this.verifySingle(email));
      const batchResults = await Promise.all(promises);

      batchResults.forEach((result) => {
        results.set(result.email, result);
      });
    }

    return results;
  }

  async uploadBulkFile(emails: string[]): Promise<string> {
    const content = emails.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });

    const formData = new FormData();
    formData.append('file_contents', blob, 'emails.txt');

    const response = await this.client
      .post(`bulk?api=${this.apiKey}`, { body: formData })
      .json<BulkUploadResponse>();

    return response.file_id;
  }

  async getBulkStatus(fileId: string): Promise<BulkStatusResponse> {
    const response = await this.get<BulkStatusResponse>(
      `bulk/status?api=${this.apiKey}&file_id=${fileId}`
    );
    return response;
  }

  async downloadBulkResults(fileId: string): Promise<VerifiedEmail[]> {
    const response = await this.client
      .get(`bulk/download?api=${this.apiKey}&file_id=${fileId}`)
      .text();

    const lines = response.split('\n').filter((line) => line.trim());
    const results: VerifiedEmail[] = [];

    for (const line of lines) {
      const [email, result] = line.split(',');
      if (email && result) {
        results.push({
          email: email.trim(),
          result: result.trim() as EmailVerificationResult,
          isValid: result.trim() === 'ok',
          isRisky: ['catch_all', 'unknown'].includes(result.trim()),
          isFree: false, // Not available in bulk results
          isRole: false, // Not available in bulk results
          suggestedEmail: null,
        });
      }
    }

    return results;
  }

  async filterValidEmails(emails: string[]): Promise<string[]> {
    const results = await this.verifyMultiple(emails);
    return Array.from(results.entries())
      .filter(([_, verification]) => verification.isValid)
      .map(([email]) => email);
  }

  async filterDeliverableEmails(
    emails: string[],
    allowRisky: boolean = false
  ): Promise<string[]> {
    const results = await this.verifyMultiple(emails);
    return Array.from(results.entries())
      .filter(
        ([_, verification]) =>
          verification.isValid || (allowRisky && verification.isRisky)
      )
      .map(([email]) => email);
  }
}

export const millionVerifier = new MillionVerifierClient();
