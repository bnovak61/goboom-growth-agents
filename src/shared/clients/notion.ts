import { BaseClient } from './base.client.js';
import { requireEnv, getEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, unknown>;
  created_time: string;
  last_edited_time: string;
}

interface NotionDatabase {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, { type: string; [key: string]: unknown }>;
}

interface NotionBlock {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface NotionSearchResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string;
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string;
}

export interface NotionPageCreate {
  parentDatabaseId: string;
  properties: Record<string, NotionPropertyValue>;
  children?: NotionBlockCreate[];
}

export type NotionPropertyValue =
  | { title: string }
  | { rich_text: string }
  | { number: number }
  | { select: string }
  | { multi_select: string[] }
  | { date: { start: string; end?: string } }
  | { checkbox: boolean }
  | { url: string }
  | { email: string }
  | { phone_number: string };

export interface NotionBlockCreate {
  type: 'paragraph' | 'heading_1' | 'heading_2' | 'heading_3' | 'bulleted_list_item' | 'numbered_list_item' | 'code' | 'divider';
  content?: string;
  language?: string;
}

export class NotionClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.notion.com/v1',
        apiKey: apiKey ?? requireEnv('NOTION_API_KEY'),
        rateLimiter: defaultRateLimiters.notion(),
        headers: {
          'Notion-Version': '2022-06-28',
        },
      },
      'notion'
    );
  }

  async getDatabase(databaseId: string): Promise<NotionDatabase> {
    const response = await this.get<NotionDatabase>(`databases/${databaseId}`);
    return response;
  }

  async queryDatabase(
    databaseId: string,
    filter?: Record<string, unknown>,
    sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>
  ): Promise<NotionPage[]> {
    const allResults: NotionPage[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      const response = await this.post<NotionQueryResponse>(
        `databases/${databaseId}/query`,
        {
          filter,
          sorts,
          start_cursor: startCursor,
          page_size: 100,
        }
      );

      allResults.push(...response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    return allResults;
  }

  async createPage(config: NotionPageCreate): Promise<NotionPage> {
    const properties = this.formatProperties(config.properties);
    const children = config.children
      ? this.formatBlocks(config.children)
      : undefined;

    const response = await this.post<NotionPage>('pages', {
      parent: { database_id: config.parentDatabaseId },
      properties,
      children,
    });

    return response;
  }

  async updatePage(
    pageId: string,
    properties: Record<string, NotionPropertyValue>
  ): Promise<NotionPage> {
    const formattedProperties = this.formatProperties(properties);
    const response = await this.patch<NotionPage>(`pages/${pageId}`, {
      properties: formattedProperties,
    });
    return response;
  }

  async getPage(pageId: string): Promise<NotionPage> {
    const response = await this.get<NotionPage>(`pages/${pageId}`);
    return response;
  }

  async getPageBlocks(pageId: string): Promise<NotionBlock[]> {
    const allBlocks: NotionBlock[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      const response = await this.get<{
        results: NotionBlock[];
        has_more: boolean;
        next_cursor?: string;
      }>(`blocks/${pageId}/children?start_cursor=${startCursor ?? ''}`);

      allBlocks.push(...response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    return allBlocks;
  }

  async appendBlocks(pageId: string, blocks: NotionBlockCreate[]): Promise<void> {
    const children = this.formatBlocks(blocks);
    await this.patch(`blocks/${pageId}/children`, { children });
  }

  async search(query: string, filter?: 'page' | 'database'): Promise<NotionPage[]> {
    const response = await this.post<NotionSearchResponse>('search', {
      query,
      filter: filter ? { property: 'object', value: filter } : undefined,
      page_size: 100,
    });

    return response.results;
  }

  async getDefaultDatabase(): Promise<NotionDatabase | null> {
    const databaseId = getEnv('NOTION_DATABASE_ID');
    if (!databaseId) return null;
    return this.getDatabase(databaseId);
  }

  private formatProperties(
    properties: Record<string, NotionPropertyValue>
  ): Record<string, unknown> {
    const formatted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(properties)) {
      if ('title' in value) {
        formatted[key] = {
          title: [{ text: { content: value.title } }],
        };
      } else if ('rich_text' in value) {
        formatted[key] = {
          rich_text: [{ text: { content: value.rich_text } }],
        };
      } else if ('number' in value) {
        formatted[key] = { number: value.number };
      } else if ('select' in value) {
        formatted[key] = { select: { name: value.select } };
      } else if ('multi_select' in value) {
        formatted[key] = {
          multi_select: value.multi_select.map((name) => ({ name })),
        };
      } else if ('date' in value) {
        formatted[key] = { date: value.date };
      } else if ('checkbox' in value) {
        formatted[key] = { checkbox: value.checkbox };
      } else if ('url' in value) {
        formatted[key] = { url: value.url };
      } else if ('email' in value) {
        formatted[key] = { email: value.email };
      } else if ('phone_number' in value) {
        formatted[key] = { phone_number: value.phone_number };
      }
    }

    return formatted;
  }

  private formatBlocks(blocks: NotionBlockCreate[]): Record<string, unknown>[] {
    return blocks.map((block) => {
      if (block.type === 'divider') {
        return { type: 'divider', divider: {} };
      }

      const richText = block.content
        ? [{ type: 'text', text: { content: block.content } }]
        : [];

      if (block.type === 'code') {
        return {
          type: 'code',
          code: {
            rich_text: richText,
            language: block.language ?? 'plain text',
          },
        };
      }

      return {
        type: block.type,
        [block.type]: { rich_text: richText },
      };
    });
  }
}

export const notion = new NotionClient();
