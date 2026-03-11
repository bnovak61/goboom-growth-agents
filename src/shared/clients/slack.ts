import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';

interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  channel: string;
  thread_ts?: string;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    email?: string;
    display_name: string;
  };
}

interface SlackPostResponse {
  ok: boolean;
  ts: string;
  channel: string;
  message: SlackMessage;
}

interface SlackListResponse<T> {
  ok: boolean;
  members?: T[];
  channels?: T[];
  messages?: T[];
  has_more?: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface SlackMessageOptions {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context' | 'actions';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
  };
  fields?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
  accessory?: Record<string, unknown>;
  elements?: Array<Record<string, unknown>>;
}

export interface SlackAttachment {
  color?: string;
  pretext?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
  footer?: string;
  ts?: number;
}

export class SlackClient extends BaseClient {
  constructor(botToken?: string) {
    super(
      {
        baseUrl: 'https://slack.com/api',
        apiKey: botToken ?? requireEnv('SLACK_BOT_TOKEN'),
        rateLimiter: defaultRateLimiters.slack(),
      },
      'slack'
    );
  }

  async postMessage(options: SlackMessageOptions): Promise<SlackPostResponse> {
    const response = await this.post<SlackPostResponse>('chat.postMessage', {
      channel: options.channel,
      text: options.text,
      thread_ts: options.threadTs,
      blocks: options.blocks,
      attachments: options.attachments,
      unfurl_links: options.unfurlLinks ?? false,
      unfurl_media: options.unfurlMedia ?? true,
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${JSON.stringify(response)}`);
    }

    return response;
  }

  async replyToMessage(
    channel: string,
    threadTs: string,
    text: string
  ): Promise<SlackPostResponse> {
    return this.postMessage({
      channel,
      text,
      threadTs,
    });
  }

  async getChannelHistory(
    channelId: string,
    limit: number = 100
  ): Promise<SlackMessage[]> {
    const response = await this.get<SlackListResponse<SlackMessage>>(
      `conversations.history?channel=${channelId}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get channel history`);
    }

    return response.messages ?? [];
  }

  async listChannels(): Promise<SlackChannel[]> {
    const allChannels: SlackChannel[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.get<SlackListResponse<SlackChannel>>(
        `conversations.list?types=public_channel,private_channel&limit=200${
          cursor ? `&cursor=${cursor}` : ''
        }`
      );

      if (!response.ok) {
        throw new Error(`Failed to list channels`);
      }

      allChannels.push(...(response.channels ?? []));
      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return allChannels;
  }

  async getUserInfo(userId: string): Promise<SlackUser> {
    const response = await this.get<{ ok: boolean; user: SlackUser }>(
      `users.info?user=${userId}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get user info for ${userId}`);
    }

    return response.user;
  }

  async listUsers(): Promise<SlackUser[]> {
    const allUsers: SlackUser[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.get<SlackListResponse<SlackUser>>(
        `users.list?limit=200${cursor ? `&cursor=${cursor}` : ''}`
      );

      if (!response.ok) {
        throw new Error(`Failed to list users`);
      }

      allUsers.push(...(response.members ?? []));
      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return allUsers;
  }

  async addReaction(
    channel: string,
    timestamp: string,
    emoji: string
  ): Promise<void> {
    const response = await this.post<{ ok: boolean }>('reactions.add', {
      channel,
      timestamp,
      name: emoji.replace(/:/g, ''),
    });

    if (!response.ok) {
      throw new Error(`Failed to add reaction`);
    }
  }

  async uploadFile(
    channels: string[],
    content: string,
    filename: string,
    title?: string
  ): Promise<void> {
    const formData = new FormData();
    formData.append('channels', channels.join(','));
    formData.append('content', content);
    formData.append('filename', filename);
    if (title) formData.append('title', title);

    await this.client.post('files.upload', { body: formData });
  }

  createAlertBlock(
    title: string,
    message: string,
    color: 'good' | 'warning' | 'danger' = 'warning'
  ): SlackAttachment {
    return {
      color:
        color === 'good' ? '#36a64f' : color === 'warning' ? '#ff9800' : '#dc3545',
      title,
      text: message,
      ts: Math.floor(Date.now() / 1000),
    };
  }

  createMetricsBlock(
    title: string,
    metrics: Record<string, string | number>
  ): SlackBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${title}*`,
      },
      fields: Object.entries(metrics).map(([key, value]) => ({
        type: 'mrkdwn' as const,
        text: `*${key}:*\n${value}`,
      })),
    };
  }
}

export const slack = new SlackClient();
