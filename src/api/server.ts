import express from 'express';
import { createLogger } from '../shared/utils/logger.js';
import { env } from '../config/index.js';
import { facebookAdsGenerator } from '../agents/facebook-ads-generator/index.js';
import { FacebookAdsOptimizer } from '../agents/facebook-ads-optimizer/index.js';
import { dashboardBuilder } from '../agents/dashboard-builder/index.js';
import { notionDocumentGenerator } from '../agents/notion-document-generator/index.js';
import { handleSlackTrigger } from '../agents/linkedin-engagement-scraper/index.js';
import { createLucaWebhookHandler } from '../agents/luca-integration/index.js';
import {
  getAgentStates,
  getSupabase,
  getPendingEscalations,
  respondToEscalation,
  getActiveClients,
  getClient,
} from '../shared/clients/supabase.js';

const logger = createLogger('api-server');
const app = express();

app.use(express.json());

// CORS for dashboard
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard metrics
app.get('/api/dashboard', async (_req, res) => {
  try {
    const metrics = await dashboardBuilder.getMetrics();
    res.json(dashboardBuilder.toJSON(metrics));
  } catch (error) {
    logger.error({ error }, 'Failed to get dashboard metrics');
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Facebook Ads endpoints
app.post('/api/ads/research', async (req, res) => {
  try {
    const { industry, audience, product, count } = req.body;
    const painPoints = await facebookAdsGenerator.researchPainPoints({
      industry,
      targetAudience: audience,
      product,
      count: count ?? 10,
    });
    res.json({ painPoints });
  } catch (error) {
    logger.error({ error }, 'Failed to research pain points');
    res.status(500).json({ error: 'Failed to research pain points' });
  }
});

app.post('/api/ads/generate', async (req, res) => {
  try {
    const { industry, audience, product, websiteUrl } = req.body;

    await facebookAdsGenerator.initialize();
    const ads = await facebookAdsGenerator.generateAds({
      researchConfig: { industry, targetAudience: audience, product },
      product,
      websiteUrl,
    });
    await facebookAdsGenerator.close();

    res.json({
      count: ads.length,
      ads: ads.map((ad) => ({
        id: ad.creative.id,
        name: ad.creative.name,
        headline: ad.creative.headline,
        body: ad.creative.primaryText,
        cta: ad.creative.callToAction,
        painPoint: ad.painPoint.text,
        template: ad.template.name,
        imagePath: ad.imagePath,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to generate ads');
    res.status(500).json({ error: 'Failed to generate ads' });
  }
});

app.post('/api/ads/optimize', async (req, res) => {
  try {
    const { dryRun } = req.body;
    const optimizer = new FacebookAdsOptimizer({ dryRun: dryRun ?? false });
    const results = await optimizer.optimize();

    res.json({
      count: results.length,
      results: results.map((r) => ({
        adId: r.adId,
        adName: r.adName,
        action: r.action,
        rule: r.rule.name,
        previousValue: r.previousValue,
        newValue: r.newValue,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to optimize ads');
    res.status(500).json({ error: 'Failed to optimize ads' });
  }
});

app.get('/api/ads/performance', async (_req, res) => {
  try {
    const metrics = await dashboardBuilder.getMetrics(true);
    res.json(metrics.facebook ?? {});
  } catch (error) {
    logger.error({ error }, 'Failed to get ad performance');
    res.status(500).json({ error: 'Failed to get performance' });
  }
});

// Notion endpoints
app.get('/api/notion/templates', (_req, res) => {
  const templates = notionDocumentGenerator.getAvailableTemplates();
  res.json({ templates });
});

app.get('/api/notion/templates/:id/variables', (req, res) => {
  const variables = notionDocumentGenerator.getTemplateVariables(req.params.id);
  res.json({ variables });
});

app.post('/api/notion/generate', async (req, res) => {
  try {
    const { templateId, databaseId, variables } = req.body;
    const doc = await notionDocumentGenerator.generateFromTemplate(
      templateId,
      databaseId,
      variables
    );
    res.json(doc);
  } catch (error) {
    logger.error({ error }, 'Failed to generate Notion document');
    res.status(500).json({ error: 'Failed to generate document' });
  }
});

// Slack webhook for LinkedIn engagement scraper
app.post('/api/webhooks/slack', async (req, res) => {
  try {
    const { challenge, event } = req.body;

    // Handle Slack URL verification
    if (challenge) {
      res.send(challenge);
      return;
    }

    // Handle app_mention or message events
    if (event && (event.type === 'app_mention' || event.type === 'message')) {
      // Acknowledge immediately
      res.sendStatus(200);

      // Process asynchronously
      handleSlackTrigger(
        {
          text: event.text,
          channel: event.channel,
          user: event.user,
        },
        {
          phantomAgentId: process.env.PHANTOM_ENGAGEMENT_SCRAPER_AGENT_ID ?? '',
          instantlyCampaignId: process.env.INSTANTLY_DEFAULT_CAMPAIGN_ID ?? '',
        }
      ).catch((error) => {
        logger.error({ error }, 'Failed to handle Slack trigger');
      });

      return;
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error({ error }, 'Slack webhook error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ============================================
// Command Center API Endpoints
// ============================================

// Agent status — all agent heartbeats + current state
app.get('/api/agents/status', async (_req, res) => {
  try {
    const states = await getAgentStates();
    res.json({ agents: states });
  } catch (error) {
    logger.error({ error }, 'Failed to get agent states');
    res.status(500).json({ error: 'Failed to get agent states' });
  }
});

// Task list — paginated with filters
app.get('/api/tasks', async (req, res) => {
  try {
    const { status, agent_name, client_id, limit = '50', offset = '0' } = req.query;

    let query = getSupabase()
      .from('agent_tasks')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) query = query.eq('status', status);
    if (agent_name) query = query.eq('agent_name', agent_name);
    if (client_id) query = query.eq('client_id', client_id);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({ tasks: data ?? [], total: count ?? 0 });
  } catch (error) {
    logger.error({ error }, 'Failed to get tasks');
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

// Single task detail
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('agent_tasks')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    logger.error({ error }, 'Failed to get task');
    res.status(500).json({ error: 'Failed to get task' });
  }
});

// Action log — paginated with filters
app.get('/api/action-log', async (req, res) => {
  try {
    const { agent_name, client_id, status, limit = '50', offset = '0' } = req.query;

    let query = getSupabase()
      .from('agent_action_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (agent_name) query = query.eq('agent_name', agent_name);
    if (client_id) query = query.eq('client_id', client_id);
    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({ actions: data ?? [], total: count ?? 0 });
  } catch (error) {
    logger.error({ error }, 'Failed to get action log');
    res.status(500).json({ error: 'Failed to get action log' });
  }
});

// Escalations — pending
app.get('/api/escalations', async (_req, res) => {
  try {
    const escalations = await getPendingEscalations();
    res.json({ escalations });
  } catch (error) {
    logger.error({ error }, 'Failed to get escalations');
    res.status(500).json({ error: 'Failed to get escalations' });
  }
});

// Respond to escalation (approve/reject)
app.post('/api/escalations/:id/respond', async (req, res) => {
  try {
    const { status, responded_by, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'status must be "approved" or "rejected"' });
      return;
    }

    const result = await respondToEscalation(
      req.params.id,
      status,
      responded_by ?? 'dashboard_user',
      notes
    );

    if (!result) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }

    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to respond to escalation');
    res.status(500).json({ error: 'Failed to respond to escalation' });
  }
});

// Clients — all with status
app.get('/api/clients', async (_req, res) => {
  try {
    const clients = await getActiveClients();
    res.json({ clients });
  } catch (error) {
    logger.error({ error }, 'Failed to get clients');
    res.status(500).json({ error: 'Failed to get clients' });
  }
});

// Single client detail
app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await getClient(req.params.id);
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Also fetch recent actions for this client
    const { data: recentActions } = await getSupabase()
      .from('agent_action_log')
      .select('*')
      .eq('client_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ client, recentActions: recentActions ?? [] });
  } catch (error) {
    logger.error({ error }, 'Failed to get client');
    res.status(500).json({ error: 'Failed to get client' });
  }
});

// Update client settings (approval mode, thresholds)
app.patch('/api/clients/:id/settings', async (req, res) => {
  try {
    const { approval_mode, budget_change_threshold, notify_on_auto, escalation_channels } = req.body;

    const updates: Record<string, unknown> = {};
    if (approval_mode !== undefined) updates.approval_mode = approval_mode;
    if (budget_change_threshold !== undefined) updates.budget_change_threshold = budget_change_threshold;
    if (notify_on_auto !== undefined) updates.notify_on_auto = notify_on_auto;
    if (escalation_channels !== undefined) updates.escalation_channels = escalation_channels;

    const { data, error } = await getSupabase()
      .from('clients')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    logger.error({ error }, 'Failed to update client settings');
    res.status(500).json({ error: 'Failed to update client settings' });
  }
});

// Metrics summary — aggregate for dashboard header
app.get('/api/metrics/summary', async (_req, res) => {
  try {
    const agents = await getAgentStates();
    const runningAgents = agents.filter((a) => a.status === 'running').length;

    // Get today's action counts
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: todayActions } = await getSupabase()
      .from('agent_action_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    const { count: pendingEscalations } = await getSupabase()
      .from('agent_escalations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const clients = await getActiveClients();

    res.json({
      agents_running: runningAgents,
      agents_total: agents.length,
      tasks_today: todayActions ?? 0,
      escalations_pending: pendingEscalations ?? 0,
      clients_active: clients.length,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get metrics summary');
    res.status(500).json({ error: 'Failed to get metrics summary' });
  }
});

// Luca Analytics webhook receiver
app.post('/api/webhooks/luca', createLucaWebhookHandler());

// Start server
const port = env.PORT;
app.listen(port, () => {
  logger.info({ port }, 'API server started');
});
