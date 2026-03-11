import { createLogger } from '../../shared/utils/logger.js';
import { phantomBuster } from '../../shared/clients/phantom-buster.js';
import { notion, NotionPageCreate } from '../../shared/clients/notion.js';
import { slack } from '../../shared/clients/slack.js';
import { LinkedInEngagement } from '../../shared/types/lead.types.js';

const logger = createLogger('linkedin-auto-responder');

export interface AutoResponderConfig {
  postUrl: string;
  phantomAgentId: string;
  triggerKeywords: string[];
  responseTemplate: string;
  notionDatabaseId?: string;
  slackChannelId?: string;
  resourceLinks: Record<string, string>;
}

export interface ProcessedComment {
  engagement: LinkedInEngagement;
  matchedKeyword: string;
  responseLink: string;
  notionPageId?: string;
}

export class LinkedInAutoResponder {
  private config: AutoResponderConfig;

  constructor(config: AutoResponderConfig) {
    this.config = config;
  }

  async processPost(): Promise<ProcessedComment[]> {
    logger.info({ postUrl: this.config.postUrl }, 'Processing LinkedIn post');

    // Scrape post engagements
    const engagements = await phantomBuster.scrapePostEngagements(
      this.config.postUrl,
      this.config.phantomAgentId
    );

    logger.info({ count: engagements.length }, 'Scraped engagements');

    // Filter for comments that match trigger keywords
    const matchingComments = this.filterMatchingComments(engagements);
    logger.info({ matchCount: matchingComments.length }, 'Found matching comments');

    const processedComments: ProcessedComment[] = [];

    for (const { engagement, keyword } of matchingComments) {
      try {
        const processed = await this.processComment(engagement, keyword);
        processedComments.push(processed);
      } catch (error) {
        logger.error(
          { error, profile: engagement.profile.profileUrl },
          'Failed to process comment'
        );
      }
    }

    // Send summary notification
    if (processedComments.length > 0 && this.config.slackChannelId) {
      await this.sendSummaryNotification(processedComments);
    }

    return processedComments;
  }

  private filterMatchingComments(
    engagements: LinkedInEngagement[]
  ): Array<{ engagement: LinkedInEngagement; keyword: string }> {
    const matches: Array<{ engagement: LinkedInEngagement; keyword: string }> = [];

    for (const engagement of engagements) {
      if (engagement.engagementType !== 'comment' || !engagement.commentText) {
        continue;
      }

      const commentLower = engagement.commentText.toLowerCase();

      for (const keyword of this.config.triggerKeywords) {
        if (commentLower.includes(keyword.toLowerCase())) {
          matches.push({ engagement, keyword });
          break; // Only match once per comment
        }
      }
    }

    return matches;
  }

  private async processComment(
    engagement: LinkedInEngagement,
    matchedKeyword: string
  ): Promise<ProcessedComment> {
    const { profile, commentText } = engagement;

    // Find the appropriate resource link
    const responseLink = this.findResourceLink(matchedKeyword);

    // Create Notion page for tracking
    let notionPageId: string | undefined;
    if (this.config.notionDatabaseId) {
      const page = await this.createNotionEntry(engagement, matchedKeyword, responseLink);
      notionPageId = page.id;
    }

    logger.info(
      {
        profileUrl: profile.profileUrl,
        keyword: matchedKeyword,
        responseLink,
      },
      'Processed comment - ready for response'
    );

    return {
      engagement,
      matchedKeyword,
      responseLink,
      notionPageId,
    };
  }

  private findResourceLink(keyword: string): string {
    // Check for exact match first
    if (this.config.resourceLinks[keyword]) {
      return this.config.resourceLinks[keyword];
    }

    // Check for partial matches
    for (const [key, link] of Object.entries(this.config.resourceLinks)) {
      if (keyword.toLowerCase().includes(key.toLowerCase())) {
        return link;
      }
    }

    // Return default link
    return this.config.resourceLinks['default'] ?? '';
  }

  private async createNotionEntry(
    engagement: LinkedInEngagement,
    keyword: string,
    responseLink: string
  ): Promise<{ id: string; url: string }> {
    const pageCreate: NotionPageCreate = {
      parentDatabaseId: this.config.notionDatabaseId!,
      properties: {
        Name: { title: `${engagement.profile.firstName ?? ''} ${engagement.profile.lastName ?? ''}` },
        'LinkedIn URL': { url: engagement.profile.profileUrl },
        'Comment': { rich_text: engagement.commentText ?? '' },
        'Keyword': { select: keyword },
        'Response Link': { url: responseLink },
        'Status': { select: 'Pending' },
        'Post URL': { url: this.config.postUrl },
      },
    };

    const page = await notion.createPage(pageCreate);
    return { id: page.id, url: page.url };
  }

  private async sendSummaryNotification(
    processedComments: ProcessedComment[]
  ): Promise<void> {
    if (!this.config.slackChannelId) return;

    const blocks = [
      slack.createMetricsBlock('LinkedIn Auto-Responder', {
        'Comments Found': processedComments.length,
        'Post': this.config.postUrl.slice(0, 50) + '...',
      }),
    ];

    const attachments = processedComments.slice(0, 5).map((pc) => {
      const name = `${pc.engagement.profile.firstName ?? ''} ${pc.engagement.profile.lastName ?? ''}`;
      return slack.createAlertBlock(
        name,
        `Keyword: ${pc.matchedKeyword}\nComment: ${pc.engagement.commentText?.slice(0, 100)}...\nLink: ${pc.responseLink}`,
        'good'
      );
    });

    await slack.postMessage({
      channel: this.config.slackChannelId,
      text: `LinkedIn Auto-Responder: Found ${processedComments.length} matching comments`,
      blocks,
      attachments,
    });
  }

  generateResponseMessage(processed: ProcessedComment): string {
    return this.config.responseTemplate
      .replace('{firstName}', processed.engagement.profile.firstName ?? 'there')
      .replace('{keyword}', processed.matchedKeyword)
      .replace('{link}', processed.responseLink);
  }
}

export function createAutoResponder(config: AutoResponderConfig): LinkedInAutoResponder {
  return new LinkedInAutoResponder(config);
}
