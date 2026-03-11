import { createLogger } from '../../shared/utils/logger.js';
import { perplexity, PainPointResearchConfig } from '../../shared/clients/perplexity.js';
import { PainPoint, AdTemplate, AdCreative } from '../../shared/types/campaign.types.js';
import { AdRenderer } from './renderer.js';
import { AdTemplates } from './templates.js';
import archiver from 'archiver';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const logger = createLogger('facebook-ads-generator');

export interface GenerateAdsConfig {
  researchConfig: PainPointResearchConfig;
  templates?: AdTemplate[];
  outputDir?: string;
  product?: string;
  logoUrl?: string;
  websiteUrl?: string;
  brandColors?: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export interface GeneratedAd {
  painPoint: PainPoint;
  template: AdTemplate;
  creative: AdCreative;
  imagePath: string;
}

export class FacebookAdsGenerator {
  private renderer: AdRenderer;

  constructor() {
    this.renderer = new AdRenderer();
  }

  async initialize(): Promise<void> {
    await this.renderer.initialize();
  }

  async close(): Promise<void> {
    await this.renderer.close();
  }

  async researchPainPoints(config: PainPointResearchConfig): Promise<PainPoint[]> {
    logger.info({ config }, 'Researching pain points');
    const painPoints = await perplexity.researchPainPoints(config);
    logger.info({ count: painPoints.length }, 'Found pain points');
    return painPoints;
  }

  async generateAds(config: GenerateAdsConfig): Promise<GeneratedAd[]> {
    const outputDir = config.outputDir ?? join(process.cwd(), 'output', 'ads');

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    logger.info({ outputDir }, 'Starting ad generation');

    // Research pain points
    const painPoints = await this.researchPainPoints(config.researchConfig);

    // Get templates
    const templates = config.templates ?? AdTemplates.getDefaultTemplates();

    const generatedAds: GeneratedAd[] = [];

    // Generate ads for each pain point and template combination
    for (const painPoint of painPoints) {
      for (const template of templates) {
        try {
          // Generate copy
          const copy = await perplexity.generateAdCopy(
            painPoint,
            config.product ?? config.researchConfig.product ?? 'our solution'
          );

          // Create creative
          const creative: AdCreative = {
            id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: `${template.name} - ${painPoint.text.slice(0, 30)}`,
            type: 'image',
            headline: copy.headline,
            primaryText: copy.body,
            callToAction: copy.cta,
            linkUrl: config.websiteUrl ?? 'https://example.com',
            width: 1080,
            height: 1080,
            createdAt: new Date(),
          };

          // Render the ad image
          const imagePath = await this.renderer.renderAd({
            creative,
            template,
            painPoint,
            logoUrl: config.logoUrl,
            brandColors: config.brandColors,
            outputDir,
          });

          creative.imagePath = imagePath;

          generatedAds.push({
            painPoint,
            template,
            creative,
            imagePath,
          });

          logger.info(
            { adId: creative.id, painPoint: painPoint.text.slice(0, 50) },
            'Generated ad'
          );
        } catch (error) {
          logger.error(
            { error, painPoint: painPoint.text, template: template.name },
            'Failed to generate ad'
          );
        }
      }
    }

    logger.info({ total: generatedAds.length }, 'Completed ad generation');
    return generatedAds;
  }

  async generateSingleAd(
    painPoint: PainPoint,
    template: AdTemplate,
    config: Omit<GenerateAdsConfig, 'researchConfig' | 'templates'>
  ): Promise<GeneratedAd> {
    const outputDir = config.outputDir ?? join(process.cwd(), 'output', 'ads');

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const copy = await perplexity.generateAdCopy(
      painPoint,
      config.product ?? 'our solution'
    );

    const creative: AdCreative = {
      id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: `${template.name} - ${painPoint.text.slice(0, 30)}`,
      type: 'image',
      headline: copy.headline,
      primaryText: copy.body,
      callToAction: copy.cta,
      linkUrl: config.websiteUrl ?? 'https://example.com',
      width: 1080,
      height: 1080,
      createdAt: new Date(),
    };

    const imagePath = await this.renderer.renderAd({
      creative,
      template,
      painPoint,
      logoUrl: config.logoUrl,
      brandColors: config.brandColors,
      outputDir,
    });

    creative.imagePath = imagePath;

    return {
      painPoint,
      template,
      creative,
      imagePath,
    };
  }

  async createZipBundle(ads: GeneratedAd[], outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        logger.info({ path: outputPath, size: archive.pointer() }, 'Created ZIP bundle');
        resolve(outputPath);
      });

      archive.on('error', reject);
      archive.pipe(output);

      // Add each ad image to the archive
      for (const ad of ads) {
        const filename = `${ad.creative.id}.png`;
        archive.file(ad.imagePath, { name: filename });
      }

      // Add a manifest file
      const manifest = ads.map((ad) => ({
        id: ad.creative.id,
        filename: `${ad.creative.id}.png`,
        headline: ad.creative.headline,
        primaryText: ad.creative.primaryText,
        callToAction: ad.creative.callToAction,
        painPoint: ad.painPoint.text,
        template: ad.template.name,
      }));

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      archive.finalize();
    });
  }
}

export const facebookAdsGenerator = new FacebookAdsGenerator();
