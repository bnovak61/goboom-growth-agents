import { z } from 'zod';

export const AdStatusSchema = z.enum([
  'draft',
  'pending_review',
  'active',
  'paused',
  'completed',
  'rejected',
  'archived',
]);

export type AdStatus = z.infer<typeof AdStatusSchema>;

export const AdTypeSchema = z.enum([
  'image',
  'video',
  'carousel',
  'collection',
  'stories',
  'reels',
]);

export type AdType = z.infer<typeof AdTypeSchema>;

export const AdCreativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AdTypeSchema,
  headline: z.string(),
  primaryText: z.string(),
  description: z.string().optional(),
  callToAction: z.string(),
  imageUrl: z.string().optional(),
  imagePath: z.string().optional(),
  videoUrl: z.string().optional(),
  linkUrl: z.string().url(),
  width: z.number().default(1080),
  height: z.number().default(1080),
  createdAt: z.date().default(() => new Date()),
});

export type AdCreative = z.infer<typeof AdCreativeSchema>;

export const AdSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  campaignId: z.string(),
  status: AdStatusSchema,
  dailyBudget: z.number().optional(),
  lifetimeBudget: z.number().optional(),
  startDate: z.date(),
  endDate: z.date().optional(),
  targeting: z.object({
    ageMin: z.number().optional(),
    ageMax: z.number().optional(),
    genders: z.array(z.enum(['male', 'female', 'all'])).optional(),
    locations: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    behaviors: z.array(z.string()).optional(),
    customAudiences: z.array(z.string()).optional(),
    lookalikes: z.array(z.string()).optional(),
  }),
  placements: z.array(z.string()).optional(),
  bidStrategy: z.string().optional(),
  optimizationGoal: z.string().optional(),
});

export type AdSet = z.infer<typeof AdSetSchema>;

export const AdSchema = z.object({
  id: z.string(),
  name: z.string(),
  adSetId: z.string(),
  creative: AdCreativeSchema,
  status: AdStatusSchema,
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Ad = z.infer<typeof AdSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.enum([
    'awareness',
    'traffic',
    'engagement',
    'leads',
    'app_promotion',
    'sales',
  ]),
  status: AdStatusSchema,
  dailyBudget: z.number().optional(),
  lifetimeBudget: z.number().optional(),
  startDate: z.date(),
  endDate: z.date().optional(),
  adSets: z.array(AdSetSchema).default([]),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Campaign = z.infer<typeof CampaignSchema>;

export const AdPerformanceSchema = z.object({
  adId: z.string(),
  dateStart: z.date(),
  dateEnd: z.date(),
  impressions: z.number(),
  reach: z.number(),
  clicks: z.number(),
  spend: z.number(),
  cpm: z.number(), // Cost per 1000 impressions
  cpc: z.number(), // Cost per click
  ctr: z.number(), // Click-through rate
  conversions: z.number().optional(),
  costPerConversion: z.number().optional(),
  frequency: z.number().optional(),
  actions: z.record(z.number()).optional(),
});

export type AdPerformance = z.infer<typeof AdPerformanceSchema>;

export const OptimizationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  condition: z.object({
    metric: z.enum(['cpm', 'cpc', 'ctr', 'spend', 'conversions', 'frequency']),
    operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
    value: z.number(),
    timeRange: z.enum(['last_1_day', 'last_3_days', 'last_7_days', 'last_14_days', 'last_30_days']),
  }),
  action: z.enum(['pause', 'increase_budget', 'decrease_budget', 'notify']),
  actionValue: z.number().optional(), // For budget changes, percentage
  priority: z.number().default(0),
});

export type OptimizationRule = z.infer<typeof OptimizationRuleSchema>;

export const PainPointSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string().optional(),
  source: z.string().optional(),
  intensity: z.enum(['low', 'medium', 'high']).optional(),
  createdAt: z.date().default(() => new Date()),
});

export type PainPoint = z.infer<typeof PainPointSchema>;

export const AdTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  accentColor: z.string(),
  fontFamily: z.string(),
  layout: z.enum(['centered', 'top', 'bottom', 'split']),
  logoUrl: z.string().optional(),
  overlayOpacity: z.number().default(0),
});

export type AdTemplate = z.infer<typeof AdTemplateSchema>;
