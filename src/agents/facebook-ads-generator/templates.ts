import { AdTemplate } from '../../shared/types/campaign.types.js';

export const DEFAULT_TEMPLATES: AdTemplate[] = [
  {
    id: 'bold-gradient',
    name: 'Bold Gradient',
    category: 'attention',
    backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    textColor: '#ffffff',
    accentColor: '#ffd700',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'centered',
    overlayOpacity: 0,
  },
  {
    id: 'dark-minimal',
    name: 'Dark Minimal',
    category: 'professional',
    backgroundColor: '#1a1a2e',
    textColor: '#ffffff',
    accentColor: '#e94560',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'centered',
    overlayOpacity: 0,
  },
  {
    id: 'warm-sunset',
    name: 'Warm Sunset',
    category: 'friendly',
    backgroundColor: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    textColor: '#ffffff',
    accentColor: '#ffecd2',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'bottom',
    overlayOpacity: 0,
  },
  {
    id: 'clean-white',
    name: 'Clean White',
    category: 'professional',
    backgroundColor: '#ffffff',
    textColor: '#1a1a2e',
    accentColor: '#4361ee',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'centered',
    overlayOpacity: 0,
  },
  {
    id: 'nature-green',
    name: 'Nature Green',
    category: 'trust',
    backgroundColor: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    textColor: '#ffffff',
    accentColor: '#f0fff0',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'top',
    overlayOpacity: 0,
  },
  {
    id: 'corporate-blue',
    name: 'Corporate Blue',
    category: 'professional',
    backgroundColor: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
    textColor: '#ffffff',
    accentColor: '#003366',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'centered',
    overlayOpacity: 0,
  },
  {
    id: 'energetic-orange',
    name: 'Energetic Orange',
    category: 'attention',
    backgroundColor: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)',
    textColor: '#ffffff',
    accentColor: '#fffacd',
    fontFamily: 'Inter, system-ui, sans-serif',
    layout: 'bottom',
    overlayOpacity: 0,
  },
  {
    id: 'tech-dark',
    name: 'Tech Dark',
    category: 'tech',
    backgroundColor: '#0f0f23',
    textColor: '#00ff88',
    accentColor: '#00ccff',
    fontFamily: 'JetBrains Mono, monospace',
    layout: 'centered',
    overlayOpacity: 0,
  },
];

export class AdTemplates {
  static getDefaultTemplates(): AdTemplate[] {
    return [...DEFAULT_TEMPLATES];
  }

  static getByCategory(category: string): AdTemplate[] {
    return DEFAULT_TEMPLATES.filter((t) => t.category === category);
  }

  static getById(id: string): AdTemplate | undefined {
    return DEFAULT_TEMPLATES.find((t) => t.id === id);
  }

  static createCustomTemplate(overrides: Partial<AdTemplate>): AdTemplate {
    const base = DEFAULT_TEMPLATES[0];
    return {
      ...base,
      ...overrides,
      id: overrides.id ?? `custom-${Date.now()}`,
      name: overrides.name ?? 'Custom Template',
    };
  }

  static createBrandedTemplates(brandColors: {
    primary: string;
    secondary: string;
    accent: string;
    textLight?: string;
    textDark?: string;
  }): AdTemplate[] {
    return [
      {
        id: 'brand-primary',
        name: 'Brand Primary',
        category: 'branded',
        backgroundColor: brandColors.primary,
        textColor: brandColors.textLight ?? '#ffffff',
        accentColor: brandColors.accent,
        fontFamily: 'Inter, system-ui, sans-serif',
        layout: 'centered',
        overlayOpacity: 0,
      },
      {
        id: 'brand-gradient',
        name: 'Brand Gradient',
        category: 'branded',
        backgroundColor: `linear-gradient(135deg, ${brandColors.primary} 0%, ${brandColors.secondary} 100%)`,
        textColor: brandColors.textLight ?? '#ffffff',
        accentColor: brandColors.accent,
        fontFamily: 'Inter, system-ui, sans-serif',
        layout: 'centered',
        overlayOpacity: 0,
      },
      {
        id: 'brand-light',
        name: 'Brand Light',
        category: 'branded',
        backgroundColor: '#ffffff',
        textColor: brandColors.textDark ?? '#1a1a2e',
        accentColor: brandColors.primary,
        fontFamily: 'Inter, system-ui, sans-serif',
        layout: 'centered',
        overlayOpacity: 0,
      },
    ];
  }
}
