# Crawl ICP Leads

Continuously prospect LinkedIn for leads matching your Ideal Customer Profile (ICP) criteria.

## Usage

```
/crawl-leads [options]
```

## Arguments

- `--titles`: Comma-separated job titles to target (required)
- `--industries`: Comma-separated industries (optional)
- `--sizes`: Comma-separated company sizes (optional)
- `--max-leads`: Maximum leads per run (default: 100)
- `--campaign-id`: Instantly campaign ID (optional)
- `--notion-db`: Notion database ID for tracking (optional)

## Example

```bash
# Crawl for marketing leaders
tsx src/agents/icp-linkedin-crawler/cli.ts crawl \
  --titles "CMO,VP Marketing,Head of Marketing" \
  --industries "Technology,SaaS" \
  --sizes "51-200,201-500" \
  --max-leads 50
```

## Scheduled Crawl

The crawler runs automatically daily at 8am via the cron scheduler:

```toml
# railway.toml
[[crons]]
name = "icp-crawler"
schedule = "0 8 * * *"
command = "tsx src/agents/icp-linkedin-crawler/cli.ts crawl"
```
