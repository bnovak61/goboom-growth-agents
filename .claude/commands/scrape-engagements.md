# Scrape LinkedIn Engagements

Scrape engagements from a LinkedIn post, enrich leads with Apollo, verify emails, and add to Instantly campaign.

## Usage

```
/scrape-engagements <linkedin-post-url>
```

## Flow

1. **Scrape**: Use PhantomBuster to extract likes, comments, and reactions
2. **Filter**: Apply ICP criteria (job titles, keywords)
3. **Enrich**: Get email and company data from Apollo
4. **Verify**: Validate emails with Million Verifier
5. **Send**: Add verified leads to Instantly campaign

## Configuration

Set these environment variables:

- `PHANTOM_ENGAGEMENT_SCRAPER_AGENT_ID`: PhantomBuster agent ID
- `INSTANTLY_DEFAULT_CAMPAIGN_ID`: Instantly campaign ID
- `APOLLO_API_KEY`: Apollo.io API key
- `MILLION_VERIFIER_API_KEY`: Million Verifier API key

## Slack Trigger

Mention the bot in Slack with a LinkedIn post URL:

```
@growthbot https://www.linkedin.com/posts/example-post-123
```
