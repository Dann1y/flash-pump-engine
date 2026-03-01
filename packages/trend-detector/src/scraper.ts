import { createLogger, getEnv } from "@flash-pump/shared";
import { withRetry } from "./retry";
import { X_API_BASE_URL, X_SEARCH_QUERY, MAX_TRENDS_PER_TICK } from "./constants";

const log = createLogger("scraper");

/** Raw trend extracted from X API response */
export interface RawTrend {
  keyword: string;
  detectedAt: Date;
  context: {
    tweetCount: number;
    sampleTweets: string[];
    imageUrls: string[];
    mentionCount: number;
  };
}

/** X API v2 Recent Search response shape */
interface XSearchResponse {
  data?: Array<{
    id: string;
    text: string;
    created_at?: string;
    public_metrics?: {
      retweet_count: number;
      reply_count: number;
      like_count: number;
      quote_count: number;
    };
    entities?: {
      hashtags?: Array<{ tag: string }>;
      urls?: Array<{ expanded_url: string; images?: Array<{ url: string }> }>;
    };
  }>;
  includes?: {
    media?: Array<{ url?: string; preview_image_url?: string }>;
  };
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count?: number;
  };
}

/** Extract trending keywords from tweets by frequency of hashtags and notable terms */
function extractKeywords(response: XSearchResponse): RawTrend[] {
  if (!response.data || response.data.length === 0) {
    return [];
  }

  // Count hashtag frequency
  const tagCounts = new Map<string, { count: number; tweets: string[]; images: string[] }>();

  for (const tweet of response.data) {
    const hashtags = tweet.entities?.hashtags ?? [];
    const imageUrls: string[] = [];

    // Collect image URLs from entities
    for (const urlEntity of tweet.entities?.urls ?? []) {
      if (urlEntity.images) {
        imageUrls.push(...urlEntity.images.map((img) => img.url));
      }
    }

    for (const ht of hashtags) {
      const tag = ht.tag.toLowerCase();
      const existing = tagCounts.get(tag) ?? { count: 0, tweets: [], images: [] };
      existing.count++;
      if (existing.tweets.length < 3) {
        existing.tweets.push(tweet.text.slice(0, 280));
      }
      existing.images.push(...imageUrls);
      tagCounts.set(tag, existing);
    }
  }

  // Sort by frequency, take top N
  const sorted = [...tagCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_TRENDS_PER_TICK);

  const now = new Date();

  return sorted
    .filter(([, data]) => data.count >= 2) // At least 2 mentions
    .map(([keyword, data]) => ({
      keyword,
      detectedAt: now,
      context: {
        tweetCount: data.count,
        sampleTweets: data.tweets,
        imageUrls: [...new Set(data.images)],
        mentionCount: data.count,
      },
    }));
}

/** Fetch trending keywords from X API v2 Recent Search */
export async function fetchTrendingKeywords(): Promise<RawTrend[]> {
  return withRetry(
    async () => {
      const env = getEnv();

      const url = new URL(`${X_API_BASE_URL}/tweets/search/recent`);
      url.searchParams.set("query", X_SEARCH_QUERY);
      url.searchParams.set("max_results", "100");
      url.searchParams.set("tweet.fields", "created_at,public_metrics,entities");
      url.searchParams.set("expansions", "attachments.media_keys");
      url.searchParams.set("media.fields", "url,preview_image_url");

      log.debug({ url: url.toString() }, "Fetching X API Recent Search");

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${env.X_API_BEARER_TOKEN}`,
        },
      });

      if (res.status === 429) {
        const resetAfter = res.headers.get("x-rate-limit-reset");
        throw new Error(
          `X API rate limited (429). Reset at: ${resetAfter ?? "unknown"}`,
        );
      }

      if (!res.ok) {
        throw new Error(`X API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as XSearchResponse;
      const trends = extractKeywords(data);

      log.info(
        { resultCount: data.meta?.result_count ?? 0, trendCount: trends.length },
        "Fetched trending keywords",
      );

      return trends;
    },
    { maxAttempts: 3, label: "fetchTrendingKeywords" },
  );
}
