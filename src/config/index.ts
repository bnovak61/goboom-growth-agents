import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  // PhantomBuster
  PHANTOM_BUSTER_API_KEY: z.string().optional(),

  // Instantly
  INSTANTLY_API_KEY: z.string().optional(),

  // Apollo
  APOLLO_API_KEY: z.string().optional(),

  // Million Verifier
  MILLION_VERIFIER_API_KEY: z.string().optional(),

  // Facebook Ads
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_ACCESS_TOKEN: z.string().optional(),
  FACEBOOK_AD_ACCOUNT_ID: z.string().optional(),

  // Notion
  NOTION_API_KEY: z.string().optional(),
  NOTION_DATABASE_ID: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Perplexity
  PERPLEXITY_API_KEY: z.string().optional(),

  // Anthropic (Claude)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Rephonic
  REPHONIC_API_KEY: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.string().transform(Number).default('3000'),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadConfig();

export function requireEnv(key: keyof typeof env): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value as string;
}

export function getEnv<K extends keyof typeof env>(key: K): (typeof env)[K] {
  return env[key];
}
