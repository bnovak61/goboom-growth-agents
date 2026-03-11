import { z } from 'zod';

export const PipelineStageSchema = z.enum([
  'scrape',
  'enrich',
  'verify',
  'filter',
  'transform',
  'send',
  'notify',
  'store',
]);

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const PipelineStatusSchema = z.enum([
  'idle',
  'running',
  'paused',
  'completed',
  'failed',
]);

export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const PipelineStepResultSchema = z.object({
  stage: PipelineStageSchema,
  status: z.enum(['success', 'failed', 'skipped']),
  inputCount: z.number(),
  outputCount: z.number(),
  duration: z.number(), // milliseconds
  error: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type PipelineStepResult = z.infer<typeof PipelineStepResultSchema>;

export const PipelineRunSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  status: PipelineStatusSchema,
  startedAt: z.date(),
  completedAt: z.date().optional(),
  steps: z.array(PipelineStepResultSchema),
  totalInputs: z.number(),
  totalOutputs: z.number(),
  errors: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type PipelineRun = z.infer<typeof PipelineRunSchema>;

export const PipelineConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  stages: z.array(
    z.object({
      stage: PipelineStageSchema,
      handler: z.string(),
      config: z.record(z.unknown()).default({}),
      continueOnError: z.boolean().default(false),
    })
  ),
  schedule: z.string().optional(), // Cron expression
  enabled: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    'linkedin-auto-responder',
    'facebook-ads-generator',
    'facebook-ads-optimizer',
    'podcast-outreach',
    'linkedin-engagement-scraper',
    'notion-document-generator',
    'icp-linkedin-crawler',
    'dashboard-builder',
  ]),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
  schedule: z.string().optional(),
  lastRunAt: z.date().optional(),
  nextRunAt: z.date().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const WebhookEventSchema = z.object({
  id: z.string(),
  source: z.enum(['slack', 'notion', 'phantombuster', 'facebook', 'instantly']),
  type: z.string(),
  payload: z.record(z.unknown()),
  receivedAt: z.date().default(() => new Date()),
  processedAt: z.date().optional(),
  status: z.enum(['pending', 'processed', 'failed']).default('pending'),
  error: z.string().optional(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const JobSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.record(z.unknown()),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'retrying']),
  priority: z.number().default(0),
  attempts: z.number().default(0),
  maxAttempts: z.number().default(3),
  createdAt: z.date().default(() => new Date()),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  error: z.string().optional(),
  result: z.unknown().optional(),
});

export type Job = z.infer<typeof JobSchema>;
