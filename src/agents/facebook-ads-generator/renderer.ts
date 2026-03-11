import puppeteer, { Browser, Page } from 'puppeteer';
import { join } from 'path';
import { createLogger } from '../../shared/utils/logger.js';
import { AdCreative, AdTemplate, PainPoint } from '../../shared/types/campaign.types.js';

const logger = createLogger('ad-renderer');

export interface RenderConfig {
  creative: AdCreative;
  template: AdTemplate;
  painPoint: PainPoint;
  logoUrl?: string;
  brandColors?: {
    primary: string;
    secondary: string;
    accent: string;
  };
  outputDir: string;
}

export class AdRenderer {
  private browser: Browser | null = null;

  async initialize(): Promise<void> {
    if (!this.browser) {
      logger.info('Initializing Puppeteer browser');
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async renderAd(config: RenderConfig): Promise<string> {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser!.newPage();
    await page.setViewport({ width: 1080, height: 1080 });

    try {
      const html = this.generateHtml(config);
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Wait for fonts to load
      await page.evaluate(() => document.fonts.ready);

      const outputPath = join(config.outputDir, `${config.creative.id}.png`);
      await page.screenshot({
        path: outputPath,
        type: 'png',
        omitBackground: false,
      });

      logger.debug({ outputPath }, 'Rendered ad image');
      return outputPath;
    } finally {
      await page.close();
    }
  }

  private generateHtml(config: RenderConfig): string {
    const { creative, template, painPoint, logoUrl } = config;

    const layoutStyles = this.getLayoutStyles(template.layout);
    const backgroundStyle = template.backgroundColor.includes('gradient')
      ? `background: ${template.backgroundColor};`
      : `background-color: ${template.backgroundColor};`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      width: 1080px;
      height: 1080px;
      ${backgroundStyle}
      font-family: ${template.fontFamily};
      color: ${template.textColor};
      display: flex;
      flex-direction: column;
      ${layoutStyles}
      padding: 80px;
      overflow: hidden;
    }

    .container {
      width: 100%;
      max-width: 920px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    .logo {
      width: 120px;
      height: 120px;
      object-fit: contain;
    }

    .pain-point {
      font-size: 56px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .headline {
      font-size: 44px;
      font-weight: 700;
      line-height: 1.3;
      color: ${template.accentColor};
    }

    .body {
      font-size: 32px;
      font-weight: 400;
      line-height: 1.5;
      opacity: 0.9;
    }

    .cta-container {
      margin-top: 24px;
    }

    .cta {
      display: inline-block;
      background: ${template.accentColor};
      color: ${template.backgroundColor.includes('gradient') ? '#1a1a2e' : template.backgroundColor};
      padding: 20px 48px;
      font-size: 28px;
      font-weight: 700;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, ${template.overlayOpacity});
      pointer-events: none;
    }

    .accent-line {
      width: 80px;
      height: 6px;
      background: ${template.accentColor};
      border-radius: 3px;
    }
  </style>
</head>
<body>
  ${template.overlayOpacity > 0 ? '<div class="overlay"></div>' : ''}

  <div class="container">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="Logo" />` : ''}

    <div class="accent-line"></div>

    <div class="pain-point">${this.escapeHtml(painPoint.text)}</div>

    <div class="headline">${this.escapeHtml(creative.headline)}</div>

    <div class="body">${this.escapeHtml(creative.primaryText)}</div>

    <div class="cta-container">
      <span class="cta">${this.escapeHtml(creative.callToAction)}</span>
    </div>
  </div>
</body>
</html>
`;
  }

  private getLayoutStyles(layout: AdTemplate['layout']): string {
    switch (layout) {
      case 'top':
        return 'justify-content: flex-start; align-items: flex-start;';
      case 'bottom':
        return 'justify-content: flex-end; align-items: flex-start;';
      case 'split':
        return 'justify-content: center; align-items: flex-start;';
      case 'centered':
      default:
        return 'justify-content: center; align-items: center; text-align: center;';
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
