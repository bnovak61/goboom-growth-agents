# Generate Facebook Ads

Generate Facebook ad creatives by researching pain points and rendering images.

## Usage

```
/generate-ads --industry "SaaS" --audience "startup founders" --product "ProductName"
```

## Arguments

- `--industry` or `-i`: Target industry (required)
- `--audience` or `-a`: Target audience description (required)
- `--product` or `-p`: Product/service name (optional)
- `--count` or `-n`: Number of pain points to research (default: 10)
- `--templates` or `-t`: Comma-separated template IDs (optional)
- `--zip` or `-z`: Create ZIP bundle of all ads (optional)

## Steps

1. Research pain points using Perplexity AI
2. Generate ad copy for each pain point
3. Render 1080x1080 PNG images using Puppeteer
4. Optionally bundle into a ZIP file

## Example

```bash
npm run job:generate-ads -- -i "ecommerce" -a "DTC brand owners" -p "ShopifyApp" -n 5 -z
```
