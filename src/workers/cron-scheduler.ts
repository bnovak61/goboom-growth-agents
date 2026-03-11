#!/usr/bin/env tsx

import { createLogger } from '../shared/utils/logger.js';
import { FacebookAdsOptimizer } from '../agents/facebook-ads-optimizer/index.js';
import { createICPCrawler } from '../agents/icp-linkedin-crawler/index.js';
import { dashboardBuilder } from '../agents/dashboard-builder/index.js';
import { slack } from '../shared/clients/slack.js';
import { Orchestrator } from '../agents/orchestrator/index.js';
import { MetaAdsEngineer } from '../agents/meta-ads-engineer/index.js';
import { PerformanceMonitor } from '../agents/performance-monitor/index.js';
import { CreativeStrategist } from '../agents/creative-strategist/index.js';
import { ClientReporter } from '../agents/client-reporter/index.js';
import { LeadQualityAgent } from '../agents/lead-quality/index.js';

const logger = createLogger('cron-scheduler');

interface ScheduledJob {
  name: string;
  schedule: string; // Cron expression
  handler: () => Promise<void>;
  enabled: boolean;
}

class CronScheduler {
  private jobs: ScheduledJob[] = [];
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  registerJob(job: ScheduledJob): void {
    this.jobs.push(job);
    logger.info({ name: job.name, schedule: job.schedule }, 'Registered job');
  }

  start(): void {
    logger.info('Starting cron scheduler');

    for (const job of this.jobs) {
      if (!job.enabled) continue;

      const intervalMs = this.parseScheduleToMs(job.schedule);
      if (intervalMs) {
        const interval = setInterval(async () => {
          await this.executeJob(job);
        }, intervalMs);

        this.intervals.set(job.name, interval);
        logger.info(
          { name: job.name, intervalMs },
          'Scheduled job'
        );

        // Run immediately on start
        this.executeJob(job);
      }
    }
  }

  stop(): void {
    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
      logger.info({ name }, 'Stopped job');
    }
    this.intervals.clear();
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const startTime = Date.now();
    logger.info({ name: job.name }, 'Executing job');

    try {
      await job.handler();
      logger.info(
        { name: job.name, duration: Date.now() - startTime },
        'Job completed'
      );
    } catch (error) {
      logger.error(
        { name: job.name, error, duration: Date.now() - startTime },
        'Job failed'
      );
    }
  }

  private parseScheduleToMs(schedule: string): number | null {
    // Simple cron-like parsing (supports basic intervals)
    // "0 */4 * * *" => every 4 hours
    // "0 8 * * *" => daily at 8am (every 24 hours)
    // "*/30 * * * *" => every 30 minutes

    const parts = schedule.split(' ');
    if (parts.length !== 5) return null;

    const [minute, hour] = parts;

    // Every N hours
    if (hour.startsWith('*/')) {
      const hours = parseInt(hour.slice(2), 10);
      return hours * 60 * 60 * 1000;
    }

    // Every N minutes
    if (minute.startsWith('*/')) {
      const minutes = parseInt(minute.slice(2), 10);
      return minutes * 60 * 1000;
    }

    // Daily at specific hour
    if (!hour.includes('*') && !hour.includes('/')) {
      return 24 * 60 * 60 * 1000;
    }

    // Default to every hour
    return 60 * 60 * 1000;
  }
}

// Job handlers
async function optimizeFacebookAds(): Promise<void> {
  const slackChannel = process.env.SLACK_CHANNEL_ID;

  const optimizer = new FacebookAdsOptimizer({
    notifySlackChannel: slackChannel,
    dryRun: false,
  });

  const results = await optimizer.optimize();

  if (results.length > 0) {
    logger.info({ actions: results.length }, 'Optimization completed');
  }
}

async function crawlICPLeads(): Promise<void> {
  const instantlyCampaignId = process.env.INSTANTLY_DEFAULT_CAMPAIGN_ID;
  const notionDatabaseId = process.env.NOTION_LEADS_DATABASE_ID;

  if (!instantlyCampaignId) {
    logger.warn('No Instantly campaign ID configured, skipping ICP crawl');
    return;
  }

  const crawler = createICPCrawler({
    icpCriteria: {
      titles: ['CEO', 'Founder', 'Head of Marketing', 'VP Marketing', 'CMO'],
      industries: ['Technology', 'Software', 'SaaS'],
      companySizes: ['11-50', '51-200', '201-500'],
    },
    maxLeadsPerRun: 50,
    instantlyCampaignId,
    notionDatabaseId,
    verifyEmails: true,
  });

  const result = await crawler.crawl();
  logger.info(
    {
      found: result.totalFound,
      verified: result.verifiedCount,
      added: result.addedToInstantly,
    },
    'ICP crawl completed'
  );
}

async function refreshDashboard(): Promise<void> {
  const metrics = await dashboardBuilder.getMetrics(true);

  const slackChannel = process.env.SLACK_DASHBOARD_CHANNEL;
  if (slackChannel) {
    const report = dashboardBuilder.generateSummaryReport(metrics);
    await slack.postMessage({
      channel: slackChannel,
      text: '```\n' + report + '\n```',
    });
  }
}

// Client configurations for PPC analysis
interface PPCClient {
  id: string;
  name: string;
  customerId: string;
  targetCpl: number;
}

const PPC_CLIENTS: PPCClient[] = [
  {
    id: 'chisholm',
    name: 'Chisholm Law Firm',
    customerId: '9926142954',
    targetCpl: 80,
  },
  // Add more clients here
];

async function runPPCAnalysisAllClients(): Promise<void> {
  const { spawn } = await import('child_process');
  const path = await import('path');
  const fs = await import('fs');

  logger.info({ clientCount: PPC_CLIENTS.length }, 'Starting PPC analysis for all clients');

  for (const client of PPC_CLIENTS) {
    logger.info({ client: client.name }, 'Analyzing client');

    try {
      await new Promise<void>((resolve, reject) => {
        const scriptPath = path.join(
          process.cwd(),
          'src/agents/google-ads-ppc/historical_analysis.py'
        );

        const pythonProcess = spawn('python3', [scriptPath], {
          env: {
            ...process.env,
            CUSTOMER_ID: client.customerId,
            TARGET_CPL: client.targetCpl.toString(),
          },
          cwd: process.cwd(),
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Python process exited with code ${code}`));
          }
        });

        pythonProcess.on('error', reject);
      });

      logger.info({ client: client.name }, 'Analysis completed');

      // Send Slack notification if configured
      const slackChannel = process.env.SLACK_PPC_CHANNEL;
      if (slackChannel) {
        const outputPath = path.join(
          process.cwd(),
          'src/agents/google-ads-ppc/historical_analysis_output.json'
        );

        if (fs.existsSync(outputPath)) {
          const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
          const monthly = data.monthly_performance || {};
          const monthKeys = Object.keys(monthly).sort();
          const latestMonth = monthKeys.length > 0 ? monthKeys[monthKeys.length - 1] : null;
          const latest = latestMonth ? monthly[latestMonth] : {};

          const message = `*PPC Analysis: ${client.name}*\n` +
            `Period: ${latestMonth || 'N/A'}\n` +
            `• CPL: $${latest.cpl?.toFixed(2) || 'N/A'} (Target: $${client.targetCpl})\n` +
            `• Conversions: ${latest.conversions?.toFixed(0) || 'N/A'}\n` +
            `• Spend: $${latest.spend?.toFixed(0) || 'N/A'}`;

          await slack.postMessage({
            channel: slackChannel,
            text: message,
          });
        }
      }
    } catch (error) {
      logger.error({ client: client.name, error }, 'Analysis failed');
    }
  }
}

async function generateWeeklyPPCReports(): Promise<void> {
  logger.info('Generating weekly PPC reports');

  const path = await import('path');
  const fs = await import('fs');

  const reports: string[] = [];

  for (const client of PPC_CLIENTS) {
    const outputPath = path.join(
      process.cwd(),
      'src/agents/google-ads-ppc/historical_analysis_output.json'
    );

    if (fs.existsSync(outputPath)) {
      const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      const monthly = data.monthly_performance || {};

      let report = `\n== ${client.name} ==\n`;
      for (const [month, perf] of Object.entries(monthly)) {
        const p = perf as any;
        const status = p.cpl <= client.targetCpl ? '✅' : '⚠️';
        report += `${month}: $${p.cpl?.toFixed(2)} CPL ${status}, ${p.conversions?.toFixed(0)} conversions\n`;
      }

      if (data.insights?.length) {
        report += '\nKey Insights:\n';
        data.insights.slice(0, 3).forEach((insight: any) => {
          const icon = insight.implication === 'positive' ? '✅' : insight.implication === 'negative' ? '❌' : 'ℹ️';
          report += `${icon} ${insight.insight}\n`;
        });
      }

      reports.push(report);
    }
  }

  // Send consolidated weekly report to Slack
  const slackChannel = process.env.SLACK_PPC_CHANNEL;
  if (slackChannel && reports.length > 0) {
    await slack.postMessage({
      channel: slackChannel,
      text: `*Weekly PPC Performance Report*\n\`\`\`${reports.join('\n')}\`\`\``,
    });
  }

  logger.info({ reportCount: reports.length }, 'Weekly reports generated');
}

// Main — supports two modes:
// 1. Legacy mode (default): individual cron jobs
// 2. Orchestrator mode (--orchestrator flag): unified agent system
async function main(): Promise<void> {
  const useOrchestrator = process.argv.includes('--orchestrator') || !!process.env.SUPABASE_URL;

  if (useOrchestrator) {
    logger.info('Starting in orchestrator mode');
    await startOrchestratorMode();
    return;
  }

  logger.info('Starting in legacy cron mode');
  await startLegacyMode();
}

async function startOrchestratorMode(): Promise<void> {
  const orchestrator = new Orchestrator();
  const metaAdsEngineer = new MetaAdsEngineer();
  const performanceMonitor = new PerformanceMonitor();
  const creativeStrategist = new CreativeStrategist();
  const clientReporter = new ClientReporter();
  const leadQuality = new LeadQualityAgent();

  // Start all agents
  await orchestrator.start();
  await metaAdsEngineer.start();
  await performanceMonitor.start();
  await creativeStrategist.start();
  await clientReporter.start();
  await leadQuality.start();

  logger.info('All agents started in orchestrator mode');

  // Handle shutdown
  const shutdown = async () => {
    logger.info('Shutting down all agents');
    await Promise.all([
      orchestrator.stop(),
      metaAdsEngineer.stop(),
      performanceMonitor.stop(),
      creativeStrategist.stop(),
      clientReporter.stop(),
      leadQuality.stop(),
    ]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startLegacyMode(): Promise<void> {
  const scheduler = new CronScheduler();

  // Register jobs
  scheduler.registerJob({
    name: 'facebook-ads-optimizer',
    schedule: '0 */4 * * *', // Every 4 hours
    handler: optimizeFacebookAds,
    enabled: !!process.env.FACEBOOK_ACCESS_TOKEN,
  });

  scheduler.registerJob({
    name: 'icp-linkedin-crawler',
    schedule: '0 8 * * *', // Daily at 8am
    handler: crawlICPLeads,
    enabled: !!process.env.APOLLO_API_KEY,
  });

  scheduler.registerJob({
    name: 'dashboard-refresh',
    schedule: '*/30 * * * *', // Every 30 minutes
    handler: refreshDashboard,
    enabled: true,
  });

  scheduler.registerJob({
    name: 'google-ads-ppc-all-clients',
    schedule: '0 6 * * *', // Daily at 6am
    handler: runPPCAnalysisAllClients,
    enabled: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  scheduler.registerJob({
    name: 'weekly-ppc-report',
    schedule: '0 8 * * 1', // Monday at 8am
    handler: generateWeeklyPPCReports,
    enabled: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  // Start scheduler
  scheduler.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down');
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down');
    scheduler.stop();
    process.exit(0);
  });

  logger.info('Cron scheduler running');
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start cron scheduler');
  process.exit(1);
});
