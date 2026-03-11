# GoBoom Growth Agents

GTM (Go-To-Market) automation agents for marketing, sales, and growth workflows. Built with TypeScript, Claude Code MCP, and React.

## Agents

| # | Agent | Purpose | Key APIs |
|---|-------|---------|----------|
| 1 | LinkedIn Auto-Responder | Reply to giveaway requests on LinkedIn posts | PhantomBuster, Notion |
| 2 | Bulk Facebook Ads Generator | Create 1080x1080 ad variations from pain points | Perplexity, Puppeteer |
| 3 | Facebook Ads Optimizer | Auto-pause losers, promote winners | Facebook Ads API |
| 4 | Podcast Outreach Pipeline | Scrape podcast hosts, cold email | Rephonic, Million Verifier, Instantly |
| 5 | LinkedIn Engagement Scraper | Extract post engagers via Slack trigger | PhantomBuster, Apollo, Instantly |
| 6 | Notion Document Generator | Create templated docs | Notion API |
| 7 | ICP LinkedIn Crawler | Continuous prospecting automation | Apollo, PhantomBuster |
| 8 | Dashboard Builder | Real-time analytics dashboards | Facebook, Instantly |

## Quick Start

```bash
# Install dependencies
npm install
cd ui && npm install && cd ..

# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Run development server
npm run dev

# Run UI development server
npm run dev:ui

# Build for production
npm run build
```

## CLI Commands

```bash
# Generate Facebook ads
npm run job:generate-ads -- -i "SaaS" -a "startup founders" -p "ProductName"

# Optimize Facebook ads (dry run)
npm run job:optimize-ads -- optimize --dry-run

# Start cron scheduler
npm run start:worker

# Start API server
npm run start:api

# Start MCP server
npm run mcp:start
```

## MCP Integration

Add to your Claude Code config:

```json
{
  "mcpServers": {
    "goboom-growth": {
      "command": "npx",
      "args": ["tsx", "/path/to/goboom-growth-agents/src/mcp/server.ts"]
    }
  }
}
```

Available tools:
- `research_pain_points` - Research pain points using Perplexity
- `generate_facebook_ads` - Generate ad creatives
- `optimize_facebook_ads` - Run optimization rules
- `get_ad_performance` - Get performance metrics
- `scrape_linkedin_engagements` - Scrape post engagers
- `run_podcast_outreach` - Find and contact podcasts
- `crawl_icp_leads` - Prospect matching leads
- `generate_notion_document` - Create templated docs
- `get_dashboard_metrics` - Aggregated metrics

## Deployment (Railway)

```bash
# Deploy to Railway
railway up
```

The `railway.toml` configures:
- API service
- Worker service (cron jobs)
- Facebook optimizer cron (every 4 hours)
- ICP crawler cron (daily at 8am)

## Project Structure

```
goboom-growth-agents/
├── src/
│   ├── agents/              # Individual automation agents
│   ├── shared/              # Shared utilities and API clients
│   ├── pipelines/           # Multi-step data pipelines
│   ├── mcp/                 # MCP server for Claude Code
│   ├── api/                 # REST API server
│   └── workers/             # Cron job scheduler
├── ui/                      # React + Vite dashboard
└── .claude/commands/        # Claude Code slash commands
```

## Required API Keys

See `.env.example` for the full list:
- Facebook Ads API
- Perplexity AI
- PhantomBuster
- Apollo.io
- Million Verifier
- Instantly
- Notion
- Slack
- Rephonic

## License

MIT
