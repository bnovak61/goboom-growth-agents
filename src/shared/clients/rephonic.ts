import { BaseClient } from './base.client.js';
import { requireEnv } from '../../config/index.js';
import { defaultRateLimiters } from '../utils/rate-limiter.js';

export interface Podcast {
  id: string;
  title: string;
  description: string;
  publisher: string;
  language: string;
  country: string;
  categories: string[];
  totalEpisodes: number;
  averageEpisodeLength: number;
  publishFrequency: string;
  latestEpisodeDate: string;
  listenScore: number;
  globalRank: number;
  websiteUrl?: string;
  rssUrl?: string;
  itunesUrl?: string;
  spotifyUrl?: string;
}

export interface PodcastHost {
  id: string;
  name: string;
  email?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  role: 'host' | 'co-host' | 'guest';
  podcastIds: string[];
}

export interface PodcastSearchParams {
  query?: string;
  categories?: string[];
  minListenScore?: number;
  maxListenScore?: number;
  language?: string;
  country?: string;
  hasEmail?: boolean;
  minEpisodes?: number;
  sortBy?: 'listen_score' | 'latest_episode' | 'total_episodes';
  page?: number;
  perPage?: number;
}

interface RephonicSearchResponse {
  results: Array<{
    id: string;
    title: string;
    description: string;
    publisher: string;
    language: string;
    country: string;
    categories: string[];
    total_episodes: number;
    average_episode_length: number;
    publish_frequency: string;
    latest_episode_date: string;
    listen_score: number;
    global_rank: number;
    website_url?: string;
    rss_url?: string;
    itunes_url?: string;
    spotify_url?: string;
  }>;
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

interface RephonicHostResponse {
  hosts: Array<{
    id: string;
    name: string;
    email?: string;
    linkedin_url?: string;
    twitter_url?: string;
    role: string;
    podcast_ids: string[];
  }>;
}

export class RephonicClient extends BaseClient {
  constructor(apiKey?: string) {
    super(
      {
        baseUrl: 'https://api.rephonic.com/v2',
        apiKey: apiKey ?? requireEnv('REPHONIC_API_KEY'),
        rateLimiter: defaultRateLimiters.rephonic(),
      },
      'rephonic'
    );
  }

  async searchPodcasts(params: PodcastSearchParams): Promise<{
    podcasts: Podcast[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const queryParams = new URLSearchParams();

    if (params.query) queryParams.set('q', params.query);
    if (params.categories?.length)
      queryParams.set('categories', params.categories.join(','));
    if (params.minListenScore)
      queryParams.set('min_listen_score', params.minListenScore.toString());
    if (params.maxListenScore)
      queryParams.set('max_listen_score', params.maxListenScore.toString());
    if (params.language) queryParams.set('language', params.language);
    if (params.country) queryParams.set('country', params.country);
    if (params.hasEmail) queryParams.set('has_email', 'true');
    if (params.minEpisodes)
      queryParams.set('min_episodes', params.minEpisodes.toString());
    if (params.sortBy) queryParams.set('sort_by', params.sortBy);
    queryParams.set('page', (params.page ?? 1).toString());
    queryParams.set('per_page', (params.perPage ?? 25).toString());

    const response = await this.get<RephonicSearchResponse>(
      `podcasts/search?${queryParams.toString()}`
    );

    return {
      podcasts: response.results.map(this.mapPodcast),
      total: response.pagination.total,
      page: response.pagination.page,
      totalPages: response.pagination.total_pages,
    };
  }

  async getPodcast(podcastId: string): Promise<Podcast> {
    const response = await this.get<RephonicSearchResponse['results'][0]>(
      `podcasts/${podcastId}`
    );
    return this.mapPodcast(response);
  }

  async getPodcastHosts(podcastId: string): Promise<PodcastHost[]> {
    const response = await this.get<RephonicHostResponse>(
      `podcasts/${podcastId}/hosts`
    );

    return response.hosts.map((host) => ({
      id: host.id,
      name: host.name,
      email: host.email,
      linkedinUrl: host.linkedin_url,
      twitterUrl: host.twitter_url,
      role: host.role as 'host' | 'co-host' | 'guest',
      podcastIds: host.podcast_ids,
    }));
  }

  async findPodcastsInNiche(
    niche: string,
    minScore: number = 30,
    limit: number = 50
  ): Promise<Podcast[]> {
    const allPodcasts: Podcast[] = [];
    let page = 1;
    const perPage = 25;

    while (allPodcasts.length < limit) {
      const result = await this.searchPodcasts({
        query: niche,
        minListenScore: minScore,
        sortBy: 'listen_score',
        page,
        perPage,
      });

      allPodcasts.push(...result.podcasts);

      if (page >= result.totalPages) break;
      page++;
    }

    return allPodcasts.slice(0, limit);
  }

  async findPodcastsWithContactInfo(
    params: PodcastSearchParams
  ): Promise<Array<Podcast & { hosts: PodcastHost[] }>> {
    const { podcasts } = await this.searchPodcasts({
      ...params,
      hasEmail: true,
    });

    const results: Array<Podcast & { hosts: PodcastHost[] }> = [];

    for (const podcast of podcasts) {
      try {
        const hosts = await this.getPodcastHosts(podcast.id);
        const hostsWithContact = hosts.filter(
          (h) => h.email || h.linkedinUrl || h.twitterUrl
        );

        if (hostsWithContact.length > 0) {
          results.push({
            ...podcast,
            hosts: hostsWithContact,
          });
        }
      } catch (error) {
        this.logger.warn(
          { podcastId: podcast.id, error },
          'Failed to get hosts for podcast'
        );
      }
    }

    return results;
  }

  async getSimilarPodcasts(podcastId: string): Promise<Podcast[]> {
    const response = await this.get<RephonicSearchResponse>(
      `podcasts/${podcastId}/similar`
    );
    return response.results.map(this.mapPodcast);
  }

  async getTopPodcastsByCategory(
    category: string,
    limit: number = 25
  ): Promise<Podcast[]> {
    const result = await this.searchPodcasts({
      categories: [category],
      sortBy: 'listen_score',
      perPage: Math.min(limit, 50),
    });
    return result.podcasts;
  }

  private mapPodcast(raw: RephonicSearchResponse['results'][0]): Podcast {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.description,
      publisher: raw.publisher,
      language: raw.language,
      country: raw.country,
      categories: raw.categories,
      totalEpisodes: raw.total_episodes,
      averageEpisodeLength: raw.average_episode_length,
      publishFrequency: raw.publish_frequency,
      latestEpisodeDate: raw.latest_episode_date,
      listenScore: raw.listen_score,
      globalRank: raw.global_rank,
      websiteUrl: raw.website_url,
      rssUrl: raw.rss_url,
      itunesUrl: raw.itunes_url,
      spotifyUrl: raw.spotify_url,
    };
  }
}

export const rephonic = new RephonicClient();
