import { createLogger } from '../../shared/utils/logger.js';
import { notion, NotionPageCreate, NotionPropertyValue, NotionBlockCreate } from '../../shared/clients/notion.js';

const logger = createLogger('notion-document-generator');

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  databaseId: string;
  properties: Record<string, NotionPropertyValue>;
  blocks: NotionBlockCreate[];
}

export interface GenerateDocumentConfig {
  template: DocumentTemplate;
  variables: Record<string, string>;
}

export interface GeneratedDocument {
  id: string;
  url: string;
  title: string;
  template: string;
  createdAt: Date;
}

const DEFAULT_TEMPLATES: Record<string, Omit<DocumentTemplate, 'databaseId'>> = {
  'meeting-notes': {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'Standard meeting notes template',
    properties: {
      Name: { title: '{{title}}' },
      Type: { select: 'Meeting Notes' },
      Date: { date: { start: '{{date}}' } },
      Attendees: { rich_text: '{{attendees}}' },
    },
    blocks: [
      { type: 'heading_1', content: '{{title}}' },
      { type: 'paragraph', content: 'Date: {{date}}' },
      { type: 'paragraph', content: 'Attendees: {{attendees}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Agenda' },
      { type: 'bulleted_list_item', content: '{{agenda_item_1}}' },
      { type: 'bulleted_list_item', content: '{{agenda_item_2}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Discussion Notes' },
      { type: 'paragraph', content: '{{notes}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Action Items' },
      { type: 'bulleted_list_item', content: '{{action_1}}' },
      { type: 'bulleted_list_item', content: '{{action_2}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Next Steps' },
      { type: 'paragraph', content: '{{next_steps}}' },
    ],
  },
  'project-brief': {
    id: 'project-brief',
    name: 'Project Brief',
    description: 'Project kickoff brief template',
    properties: {
      Name: { title: '{{project_name}}' },
      Type: { select: 'Project Brief' },
      Status: { select: 'Planning' },
      Owner: { rich_text: '{{owner}}' },
    },
    blocks: [
      { type: 'heading_1', content: '{{project_name}}' },
      { type: 'paragraph', content: 'Owner: {{owner}}' },
      { type: 'paragraph', content: 'Start Date: {{start_date}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Overview' },
      { type: 'paragraph', content: '{{overview}}' },
      { type: 'heading_2', content: 'Goals' },
      { type: 'bulleted_list_item', content: '{{goal_1}}' },
      { type: 'bulleted_list_item', content: '{{goal_2}}' },
      { type: 'heading_2', content: 'Success Metrics' },
      { type: 'bulleted_list_item', content: '{{metric_1}}' },
      { type: 'bulleted_list_item', content: '{{metric_2}}' },
      { type: 'heading_2', content: 'Timeline' },
      { type: 'paragraph', content: '{{timeline}}' },
      { type: 'heading_2', content: 'Resources' },
      { type: 'paragraph', content: '{{resources}}' },
    ],
  },
  'lead-profile': {
    id: 'lead-profile',
    name: 'Lead Profile',
    description: 'Sales lead profile template',
    properties: {
      Name: { title: '{{full_name}}' },
      Company: { rich_text: '{{company}}' },
      Title: { rich_text: '{{title}}' },
      Email: { email: '{{email}}' },
      LinkedIn: { url: '{{linkedin_url}}' },
      Status: { select: 'New' },
      Source: { select: '{{source}}' },
    },
    blocks: [
      { type: 'heading_1', content: '{{full_name}}' },
      { type: 'paragraph', content: '{{title}} at {{company}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Contact Information' },
      { type: 'bulleted_list_item', content: 'Email: {{email}}' },
      { type: 'bulleted_list_item', content: 'LinkedIn: {{linkedin_url}}' },
      { type: 'bulleted_list_item', content: 'Phone: {{phone}}' },
      { type: 'heading_2', content: 'Company Details' },
      { type: 'bulleted_list_item', content: 'Industry: {{industry}}' },
      { type: 'bulleted_list_item', content: 'Size: {{company_size}}' },
      { type: 'bulleted_list_item', content: 'Location: {{location}}' },
      { type: 'heading_2', content: 'Notes' },
      { type: 'paragraph', content: '{{notes}}' },
    ],
  },
  'campaign-report': {
    id: 'campaign-report',
    name: 'Campaign Report',
    description: 'Marketing campaign report template',
    properties: {
      Name: { title: '{{campaign_name}}' },
      Type: { select: 'Campaign Report' },
      Date: { date: { start: '{{date}}' } },
      Status: { select: '{{status}}' },
    },
    blocks: [
      { type: 'heading_1', content: '{{campaign_name}} Report' },
      { type: 'paragraph', content: 'Report Date: {{date}}' },
      { type: 'divider' },
      { type: 'heading_2', content: 'Summary' },
      { type: 'paragraph', content: '{{summary}}' },
      { type: 'heading_2', content: 'Key Metrics' },
      { type: 'bulleted_list_item', content: 'Impressions: {{impressions}}' },
      { type: 'bulleted_list_item', content: 'Clicks: {{clicks}}' },
      { type: 'bulleted_list_item', content: 'CTR: {{ctr}}' },
      { type: 'bulleted_list_item', content: 'Conversions: {{conversions}}' },
      { type: 'bulleted_list_item', content: 'Spend: {{spend}}' },
      { type: 'bulleted_list_item', content: 'CPA: {{cpa}}' },
      { type: 'heading_2', content: 'Insights' },
      { type: 'paragraph', content: '{{insights}}' },
      { type: 'heading_2', content: 'Recommendations' },
      { type: 'bulleted_list_item', content: '{{recommendation_1}}' },
      { type: 'bulleted_list_item', content: '{{recommendation_2}}' },
    ],
  },
};

export class NotionDocumentGenerator {
  async generateDocument(config: GenerateDocumentConfig): Promise<GeneratedDocument> {
    logger.info(
      { template: config.template.name, variables: Object.keys(config.variables) },
      'Generating Notion document'
    );

    // Process properties with variable substitution
    const properties = this.processProperties(config.template.properties, config.variables);

    // Process blocks with variable substitution
    const blocks = this.processBlocks(config.template.blocks, config.variables);

    // Create the page
    const pageCreate: NotionPageCreate = {
      parentDatabaseId: config.template.databaseId,
      properties,
      children: blocks,
    };

    const page = await notion.createPage(pageCreate);

    const title = this.getTitle(properties);

    logger.info(
      { pageId: page.id, title },
      'Created Notion document'
    );

    return {
      id: page.id,
      url: page.url,
      title,
      template: config.template.name,
      createdAt: new Date(),
    };
  }

  async generateFromTemplate(
    templateId: string,
    databaseId: string,
    variables: Record<string, string>
  ): Promise<GeneratedDocument> {
    const templateBase = DEFAULT_TEMPLATES[templateId];
    if (!templateBase) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const template: DocumentTemplate = {
      ...templateBase,
      databaseId,
    };

    return this.generateDocument({ template, variables });
  }

  async generateBulk(
    configs: GenerateDocumentConfig[]
  ): Promise<GeneratedDocument[]> {
    const results: GeneratedDocument[] = [];

    for (const config of configs) {
      try {
        const doc = await this.generateDocument(config);
        results.push(doc);
      } catch (error) {
        logger.error(
          { error, template: config.template.name },
          'Failed to generate document'
        );
      }
    }

    return results;
  }

  getAvailableTemplates(): Array<{ id: string; name: string; description: string }> {
    return Object.entries(DEFAULT_TEMPLATES).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
    }));
  }

  getTemplateVariables(templateId: string): string[] {
    const template = DEFAULT_TEMPLATES[templateId];
    if (!template) return [];

    const variables = new Set<string>();

    // Extract from properties
    for (const value of Object.values(template.properties)) {
      const matches = JSON.stringify(value).match(/\{\{(\w+)\}\}/g);
      if (matches) {
        matches.forEach((m) => variables.add(m.replace(/\{\{|\}\}/g, '')));
      }
    }

    // Extract from blocks
    for (const block of template.blocks) {
      if (block.content) {
        const matches = block.content.match(/\{\{(\w+)\}\}/g);
        if (matches) {
          matches.forEach((m) => variables.add(m.replace(/\{\{|\}\}/g, '')));
        }
      }
    }

    return Array.from(variables);
  }

  private processProperties(
    properties: Record<string, NotionPropertyValue>,
    variables: Record<string, string>
  ): Record<string, NotionPropertyValue> {
    const processed: Record<string, NotionPropertyValue> = {};

    for (const [key, value] of Object.entries(properties)) {
      processed[key] = this.substituteVariables(value, variables);
    }

    return processed;
  }

  private processBlocks(
    blocks: NotionBlockCreate[],
    variables: Record<string, string>
  ): NotionBlockCreate[] {
    return blocks
      .map((block) => ({
        ...block,
        content: block.content
          ? this.substituteString(block.content, variables)
          : undefined,
      }))
      .filter((block) => block.type === 'divider' || (block.content && block.content.trim()));
  }

  private substituteVariables<T>(value: T, variables: Record<string, string>): T {
    const str = JSON.stringify(value);
    const substituted = this.substituteString(str, variables);
    return JSON.parse(substituted) as T;
  }

  private substituteString(str: string, variables: Record<string, string>): string {
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
  }

  private getTitle(properties: Record<string, NotionPropertyValue>): string {
    const nameProperty = properties['Name'];
    if (nameProperty && 'title' in nameProperty) {
      return nameProperty.title;
    }
    return 'Untitled';
  }
}

export const notionDocumentGenerator = new NotionDocumentGenerator();
