# Optimize Facebook Ads

Analyze Facebook ad performance and apply optimization rules to pause losers and promote winners.

## Usage

```
/optimize-ads [options]
```

## Arguments

- `--dry-run` or `-d`: Preview changes without applying (optional)
- `--max-cpm`: Maximum CPM threshold to pause ads (default: $50)
- `--min-ctr`: Minimum CTR threshold to pause ads (default: 0.5%)
- `--slack-channel` or `-s`: Slack channel ID for notifications (optional)

## Default Rules

1. **Pause High CPM**: Pause ads with CPM > $50
2. **Pause Low CTR**: Pause ads with CTR < 0.5%
3. **Boost Winners**: Increase budget 20% for ads with CTR > 2%
4. **Alert High Frequency**: Send notification when frequency > 3
5. **Reduce Losers**: Decrease budget 30% for ads with CPC > $5

## Example

```bash
# Preview optimization changes
npm run job:optimize-ads -- optimize --dry-run

# Run optimization with custom thresholds
npm run job:optimize-ads -- optimize --max-cpm 40 --min-ctr 1.0

# Check current ad status
npm run job:optimize-ads -- status

# View optimization rules
npm run job:optimize-ads -- rules
```
