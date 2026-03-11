#!/usr/bin/env tsx

import { FacebookAdsOptimizer } from './index.js';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('facebook-ads-optimizer-cli');

interface CliOptions {
  dryRun?: boolean;
  slackChannel?: string;
  maxCpm?: number;
  minCtr?: number;
  maxCpc?: number;
  maxFrequency?: number;
}

function parseArgs(): { command: string; options: CliOptions } {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'optimize';
  const options: CliOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--dry-run':
      case '-d':
        options.dryRun = true;
        break;
      case '--slack-channel':
      case '-s':
        options.slackChannel = value;
        i++;
        break;
      case '--max-cpm':
        options.maxCpm = parseFloat(value);
        i++;
        break;
      case '--min-ctr':
        options.minCtr = parseFloat(value);
        i++;
        break;
      case '--max-cpc':
        options.maxCpc = parseFloat(value);
        i++;
        break;
      case '--max-frequency':
        options.maxFrequency = parseFloat(value);
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return { command, options };
}

function printHelp(): void {
  console.log(`
Facebook Ads Optimizer CLI

Usage:
  npm run job:optimize-ads -- [command] [options]

Commands:
  optimize    Run optimization (default)
  status      Show current ad performance
  rules       List optimization rules

Options:
  -d, --dry-run            Preview changes without applying
  -s, --slack-channel <id> Slack channel for notifications
  --max-cpm <value>        Maximum CPM threshold (default: 50)
  --min-ctr <value>        Minimum CTR threshold (default: 0.5)
  --max-cpc <value>        Maximum CPC threshold (default: 5.0)
  --max-frequency <value>  Maximum frequency threshold (default: 3.0)
  -h, --help               Show this help message

Examples:
  npm run job:optimize-ads -- optimize --dry-run
  npm run job:optimize-ads -- optimize -s C12345
  npm run job:optimize-ads -- optimize --max-cpm 40 --min-ctr 1.0
`);
}

async function runOptimize(options: CliOptions): Promise<void> {
  const optimizer = new FacebookAdsOptimizer({
    dryRun: options.dryRun ?? false,
    notifySlackChannel: options.slackChannel,
  });

  // Update rules with custom thresholds if provided
  if (options.maxCpm || options.minCtr || options.maxCpc || options.maxFrequency) {
    const rules = optimizer.getDefaultRules();

    for (const rule of rules) {
      if (rule.id === 'pause-high-cpm' && options.maxCpm) {
        rule.condition.value = options.maxCpm;
      }
      if (rule.id === 'pause-low-ctr' && options.minCtr) {
        rule.condition.value = options.minCtr;
      }
      if (rule.id === 'decrease-budget-losers' && options.maxCpc) {
        rule.condition.value = options.maxCpc;
      }
      if (rule.id === 'notify-high-frequency' && options.maxFrequency) {
        rule.condition.value = options.maxFrequency;
      }
    }

    optimizer.updateRules(rules);
  }

  console.log(`\n${options.dryRun ? '🔍 DRY RUN - ' : ''}Starting optimization...\n`);

  const results = await optimizer.optimize();

  if (results.length === 0) {
    console.log('✅ No optimization actions needed');
    return;
  }

  console.log(`\n📊 Optimization Results (${results.length} actions):\n`);

  const grouped = {
    paused: results.filter((r) => r.action === 'paused'),
    budget_increased: results.filter((r) => r.action === 'budget_increased'),
    budget_decreased: results.filter((r) => r.action === 'budget_decreased'),
    notified: results.filter((r) => r.action === 'notified'),
  };

  if (grouped.paused.length > 0) {
    console.log('🛑 PAUSED ADS:');
    for (const result of grouped.paused) {
      console.log(`   - ${result.adName}`);
      console.log(`     Rule: ${result.rule.name}`);
      console.log(`     ${result.rule.condition.metric}: ${result.previousValue.toFixed(2)}`);
    }
    console.log();
  }

  if (grouped.budget_increased.length > 0) {
    console.log('📈 BUDGET INCREASED:');
    for (const result of grouped.budget_increased) {
      console.log(`   - ${result.adName}`);
      console.log(`     $${result.previousValue?.toFixed(2)} → $${result.newValue?.toFixed(2)}`);
    }
    console.log();
  }

  if (grouped.budget_decreased.length > 0) {
    console.log('📉 BUDGET DECREASED:');
    for (const result of grouped.budget_decreased) {
      console.log(`   - ${result.adName}`);
      console.log(`     $${result.previousValue?.toFixed(2)} → $${result.newValue?.toFixed(2)}`);
    }
    console.log();
  }

  if (grouped.notified.length > 0) {
    console.log('⚠️  NOTIFICATIONS:');
    for (const result of grouped.notified) {
      console.log(`   - ${result.adName}: ${result.rule.name}`);
    }
    console.log();
  }

  console.log(
    `\n${options.dryRun ? '👆 This was a DRY RUN - no changes were applied' : '✅ Changes applied successfully'}`
  );
}

async function runStatus(): Promise<void> {
  const { facebookAds } = await import('../../shared/clients/facebook-ads.js');

  console.log('\n📊 Current Ad Performance:\n');

  const campaigns = await facebookAds.getCampaigns();
  const activeCampaigns = campaigns.filter((c) => c.status === 'active');

  console.log(`Active Campaigns: ${activeCampaigns.length}`);
  console.log();

  for (const campaign of activeCampaigns) {
    console.log(`📁 ${campaign.name}`);

    const adSets = await facebookAds.getAdSets(campaign.id);
    const activeAdSets = adSets.filter((as) => as.status === 'active');

    for (const adSet of activeAdSets) {
      console.log(`  📂 ${adSet.name} (Budget: $${adSet.dailyBudget ?? 'N/A'})`);

      const ads = await facebookAds.getAds(adSet.id);
      const activeAds = ads.filter((ad) => ad.status === 'active');

      if (activeAds.length > 0) {
        const performances = await facebookAds.getAdInsights(
          activeAds.map((a) => a.id),
          'last_7d'
        );

        const perfMap = new Map(performances.map((p) => [p.adId, p]));

        for (const ad of activeAds) {
          const perf = perfMap.get(ad.id);
          if (perf) {
            console.log(`    📄 ${ad.name}`);
            console.log(
              `       CPM: $${perf.cpm.toFixed(2)} | CPC: $${perf.cpc.toFixed(2)} | CTR: ${perf.ctr.toFixed(2)}%`
            );
            console.log(
              `       Spend: $${perf.spend.toFixed(2)} | Clicks: ${perf.clicks} | Impressions: ${perf.impressions}`
            );
          }
        }
      }
    }
    console.log();
  }
}

function runRules(): void {
  const optimizer = new FacebookAdsOptimizer();
  const rules = optimizer.getDefaultRules();

  console.log('\n📋 Optimization Rules:\n');

  for (const rule of rules) {
    const status = rule.enabled ? '✅' : '❌';
    console.log(`${status} ${rule.name}`);
    console.log(`   ID: ${rule.id}`);
    console.log(
      `   Condition: ${rule.condition.metric} ${rule.condition.operator} ${rule.condition.value}`
    );
    console.log(`   Time Range: ${rule.condition.timeRange}`);
    console.log(`   Action: ${rule.action}${rule.actionValue ? ` (${rule.actionValue}%)` : ''}`);
    console.log();
  }
}

async function main(): Promise<void> {
  const { command, options } = parseArgs();

  try {
    switch (command) {
      case 'optimize':
        await runOptimize(options);
        break;
      case 'status':
        await runStatus();
        break;
      case 'rules':
        runRules();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.error({ error }, 'Command failed');
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
