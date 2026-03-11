import { z } from 'zod';

export const LeadSourceSchema = z.enum([
  'linkedin',
  'facebook',
  'podcast',
  'website',
  'referral',
  'cold_outreach',
  'event',
  'other',
]);

export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadStatusSchema = z.enum([
  'new',
  'enriched',
  'verified',
  'contacted',
  'responded',
  'qualified',
  'converted',
  'unqualified',
  'bounced',
]);

export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSchema = z.object({
  id: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  email: z.string().email().optional(),
  emailVerified: z.boolean().default(false),
  phone: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  companyDomain: z.string().optional(),
  companySize: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  source: LeadSourceSchema,
  sourceDetails: z.string().optional(),
  status: LeadStatusSchema.default('new'),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
  metadata: z.record(z.unknown()).default({}),
});

export type Lead = z.infer<typeof LeadSchema>;

export const ContactSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  type: z.enum(['email', 'linkedin', 'phone', 'other']),
  direction: z.enum(['inbound', 'outbound']),
  subject: z.string().optional(),
  content: z.string(),
  sentAt: z.date(),
  openedAt: z.date().optional(),
  repliedAt: z.date().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type Contact = z.infer<typeof ContactSchema>;

export const LinkedInProfileSchema = z.object({
  profileUrl: z.string().url(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  location: z.string().optional(),
  connectionDegree: z.string().optional(),
  profileImageUrl: z.string().optional(),
  about: z.string().optional(),
  followers: z.number().optional(),
  connections: z.number().optional(),
});

export type LinkedInProfile = z.infer<typeof LinkedInProfileSchema>;

export const LinkedInEngagementSchema = z.object({
  postUrl: z.string().url(),
  engagementType: z.enum(['like', 'comment', 'share', 'reaction']),
  profile: LinkedInProfileSchema,
  commentText: z.string().optional(),
  reactionType: z.string().optional(),
  engagedAt: z.date().optional(),
});

export type LinkedInEngagement = z.infer<typeof LinkedInEngagementSchema>;
