#!/usr/bin/env tsx

import { facebookAdsGenerator, GenerateAdsConfig } from './index.js';
import { AdTemplates } from './templates.js';
import { createLogger } from '../../shared/utils/logger.js';
import { join } from 'path';

const logger = createLogger('facebook-ads-cli');

interface CliOptions {
  industry: string;
  audience: string;
  product?: string;
  competitors?: string[];
  painPointCount?: number;
  templates?: string[];
  outputDir?: string;
  logoUrl?: string;
  websiteUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  createZip?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    industry: '',
    audience: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--industry':
      case '-i':
        options.industry = value;
        i++;
        break;
      case '--audience':
      case '-a':
        options.audience = value;
        i++;
        break;
      case '--product':
      case '-p':
        options.product = value;
        i++;
        break;
      case '--competitors':
      case '-c':
        options.competitors = value.split(',').map((s) => s.trim());
        i++;
        break;
      case '--count':
      case '-n':
        options.painPointCount = parseInt(value, 10);
        i++;
        break;
      case '--templates':
      case '-t':
        options.templates = value.split(',').map((s) => s.trim());
        i++;
        break;
      case '--output':
      case '-o':
        options.outputDir = value;
        i++;
        break;
      case '--logo':
        options.logoUrl = value;
        i++;
        break;
      case '--website':
      case '-w':
        options.websiteUrl = value;
        i++;
        break;
      case '--primary-color':
        options.primaryColor = value;
        i++;
        break;
      case '--secondary-color':
        options.secondaryColor = value;
        i++;
        break;
      case '--accent-color':
        options.accentColor = value;
        i++;
        break;
      case '--zip':
      case '-z':
        options.createZip = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Facebook Ads Generator CLI

Usage:
  npm run job:generate-ads -- [options]

Options:
  -i, --industry <industry>       Target industry (required)
  -a, --audience <audience>       Target audience description (required)
  -p, --product <product>         Product/service name
  -c, --competitors <list>        Comma-separated competitor names
  -n, --count <number>            Number of pain points to research (default: 10)
  -t, --templates <list>          Comma-separated template IDs
  -o, --output <dir>              Output directory (default: ./output/ads)
  --logo <url>                    Logo URL to include in ads
  -w, --website <url>             Website URL for CTA
  --primary-color <hex>           Brand primary color
  --secondary-color <hex>         Brand secondary color
  --accent-color <hex>            Brand accent color
  -z, --zip                       Create ZIP bundle of all ads
  -h, --help                      Show this help message

Examples:
  npm run job:generate-ads -- -i "SaaS" -a "startup founders" -p "ProductName"
  npm run job:generate-ads -- -i "ecommerce" -a "DTC brand owners" -n 5 -z
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options.industry || !options.audience) {
    console.error('Error: --industry and --audience are required');
    printHelp();
    process.exit(1);
  }

  logger.info({ options }, 'Starting ad generation');

  try {
    await facebookAdsGenerator.initialize();

    // Build templates
    let templates = AdTemplates.getDefaultTemplates();

    if (options.templates?.length) {
      templates = templates.filter((t) => options.templates!.includes(t.id));
    }

    if (options.primaryColor && options.secondaryColor && options.accentColor) {
      const brandedTemplates = AdTemplates.createBrandedTemplates({
        primary: options.primaryColor,
        secondary: options.secondaryColor,
        accent: options.accentColor,
      });
      templates = [...templates, ...brandedTemplates];
    }

    const config: GenerateAdsConfig = {
      researchConfig: {
        industry: options.industry,
        targetAudience: options.audience,
        product: options.product,
        competitors: options.competitors,
        count: options.painPointCount ?? 10,
      },
      templates,
      outputDir: options.outputDir ?? join(process.cwd(), 'output', 'ads'),
      product: options.product,
      logoUrl: options.logoUrl,
      websiteUrl: options.websiteUrl,
      brandColors: options.primaryColor
        ? {
            primary: options.primaryColor,
            secondary: options.secondaryColor ?? options.primaryColor,
            accent: options.accentColor ?? '#ffffff',
          }
        : undefined,
    };

    const ads = await facebookAdsGenerator.generateAds(config);

    console.log(`\nGenerated ${ads.length} ads`);

    if (options.createZip && ads.length > 0) {
      const zipPath = join(
        config.outputDir!,
        `ads-${Date.now()}.zip`
      );
      await facebookAdsGenerator.createZipBundle(ads, zipPath);
      console.log(`Created ZIP bundle: ${zipPath}`);
    }

    // Print summary
    console.log('\nGenerated Ads:');
    for (const ad of ads) {
      console.log(`  - ${ad.creative.name}`);
      console.log(`    Pain Point: ${ad.painPoint.text.slice(0, 60)}...`);
      console.log(`    Template: ${ad.template.name}`);
      console.log(`    File: ${ad.imagePath}`);
      console.log();
    }

  } catch (error) {
    logger.error({ error }, 'Failed to generate ads');
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await facebookAdsGenerator.close();
  }
}

main();
