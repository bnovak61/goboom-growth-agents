#!/usr/bin/env tsx

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../shared/utils/logger.js';
import { facebookAdsGenerator } from '../agents/facebook-ads-generator/index.js';
import { FacebookAdsOptimizer } from '../agents/facebook-ads-optimizer/index.js';
import { createPodcastOutreach } from '../agents/podcast-outreach/index.js';
import { createEngagementScraper } from '../agents/linkedin-engagement-scraper/index.js';
import { notionDocumentGenerator } from '../agents/notion-document-generator/index.js';
import { createICPCrawler } from '../agents/icp-linkedin-crawler/index.js';
import { dashboardBuilder } from '../agents/dashboard-builder/index.js';
import { createGoogleAdsAnalyzer } from '../agents/google-ads-analyzer/index.js';

const logger = createLogger('mcp-server');

const server = new Server(
  {
    name: 'goboom-growth-agents',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'research_pain_points',
        description: 'Research pain points for a target audience in a specific industry using Perplexity AI',
        inputSchema: {
          type: 'object',
          properties: {
            industry: { type: 'string', description: 'The target industry' },
            audience: { type: 'string', description: 'The target audience description' },
            product: { type: 'string', description: 'The product or service name (optional)' },
            count: { type: 'number', description: 'Number of pain points to research (default: 10)' },
          },
          required: ['industry', 'audience'],
        },
      },
      {
        name: 'generate_facebook_ads',
        description: 'Generate Facebook ad creatives from pain points with Puppeteer rendering',
        inputSchema: {
          type: 'object',
          properties: {
            industry: { type: 'string', description: 'The target industry' },
            audience: { type: 'string', description: 'The target audience' },
            product: { type: 'string', description: 'Product name' },
            websiteUrl: { type: 'string', description: 'Website URL for CTA' },
            templateIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Template IDs to use (optional)'
            },
          },
          required: ['industry', 'audience'],
        },
      },
      {
        name: 'optimize_facebook_ads',
        description: 'Analyze Facebook ad performance and apply optimization rules',
        inputSchema: {
          type: 'object',
          properties: {
            dryRun: { type: 'boolean', description: 'Preview changes without applying (default: false)' },
            maxCpm: { type: 'number', description: 'Maximum CPM threshold to pause ads' },
            minCtr: { type: 'number', description: 'Minimum CTR threshold to pause ads' },
          },
        },
      },
      {
        name: 'get_ad_performance',
        description: 'Get current Facebook ad performance metrics',
        inputSchema: {
          type: 'object',
          properties: {
            dateRange: {
              type: 'string',
              enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d'],
              description: 'Date range for metrics'
            },
          },
        },
      },
      {
        name: 'scrape_linkedin_engagements',
        description: 'Scrape engagements from a LinkedIn post and enrich leads',
        inputSchema: {
          type: 'object',
          properties: {
            postUrl: { type: 'string', description: 'LinkedIn post URL' },
            phantomAgentId: { type: 'string', description: 'PhantomBuster agent ID' },
            instantlyCampaignId: { type: 'string', description: 'Instantly campaign ID' },
            filterTitles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by job titles'
            },
          },
          required: ['postUrl', 'phantomAgentId', 'instantlyCampaignId'],
        },
      },
      {
        name: 'run_podcast_outreach',
        description: 'Find podcasts in a niche and create outreach campaign',
        inputSchema: {
          type: 'object',
          properties: {
            niche: { type: 'string', description: 'Podcast niche/topic' },
            minListenScore: { type: 'number', description: 'Minimum listen score (default: 30)' },
            maxPodcasts: { type: 'number', description: 'Max podcasts to find (default: 50)' },
            instantlyCampaignId: { type: 'string', description: 'Instantly campaign ID' },
          },
          required: ['niche', 'instantlyCampaignId'],
        },
      },
      {
        name: 'crawl_icp_leads',
        description: 'Crawl LinkedIn for leads matching ICP criteria',
        inputSchema: {
          type: 'object',
          properties: {
            titles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Job titles to target'
            },
            industries: {
              type: 'array',
              items: { type: 'string' },
              description: 'Industries to target'
            },
            companySizes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Company size ranges'
            },
            maxLeads: { type: 'number', description: 'Maximum leads to find' },
            instantlyCampaignId: { type: 'string', description: 'Instantly campaign ID (optional)' },
          },
          required: ['titles'],
        },
      },
      {
        name: 'generate_notion_document',
        description: 'Generate a Notion document from a template',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: {
              type: 'string',
              enum: ['meeting-notes', 'project-brief', 'lead-profile', 'campaign-report'],
              description: 'Template to use'
            },
            databaseId: { type: 'string', description: 'Notion database ID' },
            variables: {
              type: 'object',
              description: 'Variables to substitute in template'
            },
          },
          required: ['templateId', 'databaseId', 'variables'],
        },
      },
      {
        name: 'get_dashboard_metrics',
        description: 'Get aggregated metrics from all connected platforms',
        inputSchema: {
          type: 'object',
          properties: {
            forceRefresh: { type: 'boolean', description: 'Force refresh cached data' },
          },
        },
      },
      {
        name: 'analyze_google_ads',
        description: 'Analyze Google Ads campaigns for a client and generate optimization recommendations',
        inputSchema: {
          type: 'object',
          properties: {
            clientId: { type: 'string', description: 'Client ID' },
            clientName: { type: 'string', description: 'Client name' },
            googleAdsCustomerId: { type: 'string', description: 'Google Ads customer ID' },
            targetCPL: { type: 'number', description: 'Target cost per lead' },
            dateRange: {
              type: 'string',
              enum: ['last7', 'last14', 'last30', 'last90'],
              description: 'Date range for analysis'
            },
          },
          required: ['clientId', 'clientName', 'googleAdsCustomerId', 'targetCPL'],
        },
      },
      {
        name: 'approve_google_ads_action',
        description: 'Approve a pending Google Ads optimization action',
        inputSchema: {
          type: 'object',
          properties: {
            clientId: { type: 'string', description: 'Client ID' },
            actionId: { type: 'string', description: 'Action ID to approve' },
          },
          required: ['clientId', 'actionId'],
        },
      },
      {
        name: 'execute_google_ads_actions',
        description: 'Execute all approved Google Ads actions for a client',
        inputSchema: {
          type: 'object',
          properties: {
            clientId: { type: 'string', description: 'Client ID' },
            googleAdsCustomerId: { type: 'string', description: 'Google Ads customer ID' },
          },
          required: ['clientId', 'googleAdsCustomerId'],
        },
      },
      {
        name: 'run_ppc_analysis',
        description: 'Run comprehensive PPC analysis for a Google Ads account using Python historical analysis',
        inputSchema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Google Ads customer ID' },
            clientName: { type: 'string', description: 'Client name for reporting' },
            targetCpl: { type: 'number', description: 'Target cost per lead (default: 80)' },
            fullReport: { type: 'boolean', description: 'Generate comprehensive report' },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'get_ppc_report',
        description: 'Get the latest PPC analysis report for a client',
        inputSchema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Google Ads customer ID' },
            format: {
              type: 'string',
              enum: ['json', 'text', 'summary'],
              description: 'Output format (default: summary)'
            },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'execute_ppc_actions',
        description: 'Execute approved PPC optimizations (negative keywords, bid adjustments)',
        inputSchema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Google Ads customer ID' },
            actionType: {
              type: 'string',
              enum: ['add_negatives', 'adjust_bids', 'pause_campaigns', 'all'],
              description: 'Type of actions to execute'
            },
            dryRun: { type: 'boolean', description: 'Preview changes without executing' },
          },
          required: ['customerId'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  logger.info({ tool: name, args }, 'Tool called');

  try {
    switch (name) {
      case 'research_pain_points': {
        const painPoints = await facebookAdsGenerator.researchPainPoints({
          industry: args.industry as string,
          targetAudience: args.audience as string,
          product: args.product as string | undefined,
          count: (args.count as number) ?? 10,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(painPoints, null, 2),
            },
          ],
        };
      }

      case 'generate_facebook_ads': {
        await facebookAdsGenerator.initialize();
        const ads = await facebookAdsGenerator.generateAds({
          researchConfig: {
            industry: args.industry as string,
            targetAudience: args.audience as string,
            product: args.product as string | undefined,
          },
          product: args.product as string | undefined,
          websiteUrl: args.websiteUrl as string | undefined,
        });
        await facebookAdsGenerator.close();
        return {
          content: [
            {
              type: 'text',
              text: `Generated ${ads.length} ads:\n${ads.map((a) => `- ${a.creative.name}: ${a.imagePath}`).join('\n')}`,
            },
          ],
        };
      }

      case 'optimize_facebook_ads': {
        const optimizer = new FacebookAdsOptimizer({
          dryRun: (args.dryRun as boolean) ?? false,
        });
        const results = await optimizer.optimize();
        return {
          content: [
            {
              type: 'text',
              text: `Optimization complete. ${results.length} actions taken:\n${results
                .map((r) => `- ${r.action}: ${r.adName} (${r.rule.name})`)
                .join('\n')}`,
            },
          ],
        };
      }

      case 'get_ad_performance': {
        const metrics = await dashboardBuilder.getMetrics(true);
        return {
          content: [
            {
              type: 'text',
              text: dashboardBuilder.generateSummaryReport(metrics),
            },
          ],
        };
      }

      case 'scrape_linkedin_engagements': {
        const scraper = createEngagementScraper({
          phantomAgentId: args.phantomAgentId as string,
          instantlyCampaignId: args.instantlyCampaignId as string,
          filterOptions: args.filterTitles
            ? { requiredTitles: args.filterTitles as string[] }
            : undefined,
        });
        const result = await scraper.processPost(args.postUrl as string);
        return {
          content: [
            {
              type: 'text',
              text: `Scraped ${result.leads.length} leads, enriched ${result.enrichedCount}, verified ${result.verifiedCount}, added ${result.addedToInstantly} to Instantly`,
            },
          ],
        };
      }

      case 'run_podcast_outreach': {
        const pipeline = createPodcastOutreach({
          niche: args.niche as string,
          minListenScore: (args.minListenScore as number) ?? 30,
          maxPodcasts: (args.maxPodcasts as number) ?? 50,
          instantlyCampaignId: args.instantlyCampaignId as string,
          emailTemplate: {
            subject: 'Collaboration opportunity',
            body: 'Hi {firstName}, I love your podcast {podcastName}...',
          },
        });
        const result = await pipeline.run();
        return {
          content: [
            {
              type: 'text',
              text: `Found ${result.prospects.length} prospects, verified ${result.emailsVerified} emails, added ${result.addedToInstantly} to Instantly`,
            },
          ],
        };
      }

      case 'crawl_icp_leads': {
        const crawler = createICPCrawler({
          icpCriteria: {
            titles: args.titles as string[],
            industries: args.industries as string[] | undefined,
            companySizes: args.companySizes as string[] | undefined,
          },
          maxLeadsPerRun: (args.maxLeads as number) ?? 100,
          instantlyCampaignId: args.instantlyCampaignId as string | undefined,
        });
        const result = await crawler.crawl();
        return {
          content: [
            {
              type: 'text',
              text: `Found ${result.totalFound} leads, enriched ${result.enrichedCount}, verified ${result.verifiedCount}, added ${result.addedToInstantly} to Instantly`,
            },
          ],
        };
      }

      case 'generate_notion_document': {
        const doc = await notionDocumentGenerator.generateFromTemplate(
          args.templateId as string,
          args.databaseId as string,
          args.variables as Record<string, string>
        );
        return {
          content: [
            {
              type: 'text',
              text: `Created document: ${doc.title}\nURL: ${doc.url}`,
            },
          ],
        };
      }

      case 'get_dashboard_metrics': {
        const metrics = await dashboardBuilder.getMetrics(
          (args.forceRefresh as boolean) ?? false
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dashboardBuilder.toJSON(metrics), null, 2),
            },
          ],
        };
      }

      case 'analyze_google_ads': {
        const analyzer = createGoogleAdsAnalyzer({ dryRun: true });
        const result = await analyzer.analyzeClient({
          clientId: args.clientId as string,
          clientName: args.clientName as string,
          googleAdsCustomerId: args.googleAdsCustomerId as string,
          targetCPL: args.targetCPL as number,
        });
        const report = analyzer.generateReport(result);
        return {
          content: [
            {
              type: 'text',
              text: report,
            },
          ],
        };
      }

      case 'approve_google_ads_action': {
        const analyzer = createGoogleAdsAnalyzer();
        await analyzer.approveAction(
          args.clientId as string,
          args.actionId as string
        );
        return {
          content: [
            {
              type: 'text',
              text: `Approved action ${args.actionId} for client ${args.clientId}`,
            },
          ],
        };
      }

      case 'execute_google_ads_actions': {
        const analyzer = createGoogleAdsAnalyzer({ dryRun: false });
        await analyzer.executeApprovedActions(
          args.clientId as string,
          args.googleAdsCustomerId as string
        );
        return {
          content: [
            {
              type: 'text',
              text: `Executed all approved actions for client ${args.clientId}`,
            },
          ],
        };
      }

      case 'run_ppc_analysis': {
        const { spawn } = await import('child_process');
        const path = await import('path');
        const fs = await import('fs');

        const customerId = args.customerId as string;
        const targetCpl = (args.targetCpl as number) || 80;

        return new Promise((resolve) => {
          const scriptPath = path.join(
            process.cwd(),
            'src/agents/google-ads-ppc/historical_analysis.py'
          );

          const pythonProcess = spawn('python3', [scriptPath], {
            env: {
              ...process.env,
              CUSTOMER_ID: customerId,
              TARGET_CPL: targetCpl.toString(),
            },
            cwd: process.cwd(),
          });

          let stdout = '';
          let stderr = '';

          pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          pythonProcess.on('close', (code) => {
            if (code === 0) {
              const outputPath = path.join(
                process.cwd(),
                'src/agents/google-ads-ppc/historical_analysis_output.json'
              );
              let summary = 'Analysis completed successfully.\n\n';

              try {
                if (fs.existsSync(outputPath)) {
                  const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                  const monthly = data.monthly_performance || {};
                  const monthKeys = Object.keys(monthly).sort();
                  const latestMonth = monthKeys.length > 0 ? monthKeys[monthKeys.length - 1] : null;
                  const latest = latestMonth ? monthly[latestMonth] : {};

                  summary += `Latest Performance (${latestMonth}):\n`;
                  summary += `• Spend: $${latest.spend?.toFixed(2) || 'N/A'}\n`;
                  summary += `• Conversions: ${latest.conversions?.toFixed(0) || 'N/A'}\n`;
                  summary += `• CPL: $${latest.cpl?.toFixed(2) || 'N/A'}\n`;
                  summary += `• CTR: ${latest.ctr?.toFixed(2) || 'N/A'}%\n\n`;

                  if (data.insights?.length) {
                    summary += 'Key Insights:\n';
                    data.insights.slice(0, 3).forEach((insight: any) => {
                      summary += `• ${insight.insight}\n`;
                    });
                  }
                }
              } catch (e) {
                summary += 'Could not parse output file.';
              }

              resolve({
                content: [{ type: 'text', text: summary }],
              });
            } else {
              resolve({
                content: [
                  {
                    type: 'text',
                    text: `Analysis failed: ${stderr || stdout || `Exit code ${code}`}`,
                  },
                ],
                isError: true,
              });
            }
          });
        });
      }

      case 'get_ppc_report': {
        const fs = await import('fs');
        const path = await import('path');

        const format = (args.format as string) || 'summary';
        const outputPath = path.join(
          process.cwd(),
          'src/agents/google-ads-ppc/historical_analysis_output.json'
        );

        if (!fs.existsSync(outputPath)) {
          return {
            content: [
              {
                type: 'text',
                text: 'No analysis report found. Run run_ppc_analysis first.',
              },
            ],
            isError: true,
          };
        }

        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

        if (format === 'json') {
          return {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          };
        }

        // Summary format
        let report = `PPC Analysis Report\n`;
        report += `Generated: ${data.generated_at}\n`;
        report += `Customer: ${data.customer_id}\n`;
        report += `Target CPL: $${data.target_cpl}\n\n`;

        if (data.executive_summary) {
          report += `== Executive Summary ==\n`;
          report += `${data.executive_summary.headline}\n`;
          report += `${data.executive_summary.key_finding || data.executive_summary.key_insight}\n\n`;
        }

        if (data.monthly_performance) {
          report += `== Monthly Performance ==\n`;
          for (const [month, perf] of Object.entries(data.monthly_performance)) {
            const p = perf as any;
            report += `${month}: $${p.cpl?.toFixed(2)} CPL, ${p.conversions?.toFixed(0)} conversions\n`;
          }
        }

        return {
          content: [{ type: 'text', text: report }],
        };
      }

      case 'execute_ppc_actions': {
        const customerId = args.customerId as string;
        const actionType = (args.actionType as string) || 'all';
        const dryRun = (args.dryRun as boolean) ?? true;

        // For now, return a placeholder - actual execution would use the Python scripts
        return {
          content: [
            {
              type: 'text',
              text: `PPC Actions for ${customerId}:\n` +
                `Action Type: ${actionType}\n` +
                `Dry Run: ${dryRun}\n\n` +
                `To execute actual changes, use the Python scripts:\n` +
                `• add_negatives.py - Add negative keywords\n` +
                `• execute_fixes.py - Execute approved optimizations\n` +
                `• remove_bad_negatives.py - Clean up blocking keywords`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error({ error, tool: name }, 'Tool execution failed');
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started');
}

main().catch((error) => {
  logger.error({ error }, 'MCP server failed to start');
  process.exit(1);
});
