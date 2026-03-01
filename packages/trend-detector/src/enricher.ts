import {
  createLogger,
  getEnv,
  type TweetRef,
  type EnrichedTweet,
  type ScorerContext,
} from "@flash-pump/shared";
import { withRetry } from "./retry";
import { ENRICHER_CONCURRENCY, FXTWITTER_USER_AGENT } from "./constants";

const log = createLogger("enricher");

/** fxtwitter API response shape (subset) */
interface FxTweetResponse {
  code: number;
  message: string;
  tweet?: {
    text: string;
    likes: number;
    retweets: number;
    views: number;
    created_at: string;
    media?: {
      all: Array<{ type: string; url: string }>;
    };
    author: {
      followers: number;
      screen_name: string;
    };
  };
}

/** Fetch a single tweet via fxtwitter API */
async function fetchTweet(
  ref: TweetRef,
  apiBase: string,
): Promise<EnrichedTweet | null> {
  return withRetry(
    async () => {
      const url = `${apiBase}/${ref.screenName}/status/${ref.tweetId}`;

      const res = await fetch(url, {
        headers: { "User-Agent": FXTWITTER_USER_AGENT },
      });

      if (res.status === 404 || res.status === 401) {
        log.debug({ ref, status: res.status }, "Tweet not accessible, skipping");
        return null;
      }

      if (!res.ok) {
        throw new Error(`fxtwitter API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as FxTweetResponse;

      if (!data.tweet) {
        log.debug({ ref }, "No tweet data in fxtwitter response");
        return null;
      }

      const t = data.tweet;
      return {
        text: t.text,
        likes: t.likes,
        retweets: t.retweets,
        views: t.views ?? 0,
        authorFollowers: t.author.followers,
        hasMedia: (t.media?.all?.length ?? 0) > 0,
        createdAt: t.created_at,
      };
    },
    { maxAttempts: 3, label: `fetchTweet:${ref.tweetId}` },
  );
}

/** Process tweet refs in batches of ENRICHER_CONCURRENCY */
async function enrichBatch(
  refs: TweetRef[],
  apiBase: string,
): Promise<EnrichedTweet[]> {
  const results: EnrichedTweet[] = [];

  for (let i = 0; i < refs.length; i += ENRICHER_CONCURRENCY) {
    const batch = refs.slice(i, i + ENRICHER_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((ref) => fetchTweet(ref, apiBase)),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      } else if (result.status === "rejected") {
        log.warn({ error: result.reason }, "Tweet enrichment failed");
      }
    }
  }

  return results;
}

/** Enrich a raw trend's tweet refs via fxtwitter and build a ScorerContext */
export async function enrichTrend(
  keyword: string,
  tweetRefs: TweetRef[],
): Promise<ScorerContext> {
  const env = getEnv();
  const apiBase = env.FXTWITTER_API_BASE;

  log.info({ keyword, refCount: tweetRefs.length }, "Enriching trend");

  const enrichedTweets = await enrichBatch(tweetRefs, apiBase);

  const totalEngagement = enrichedTweets.reduce(
    (sum, t) => sum + t.likes + t.retweets,
    0,
  );
  const avgEngagement =
    enrichedTweets.length > 0
      ? totalEngagement / enrichedTweets.length
      : 0;
  const topTweetViews = enrichedTweets.reduce(
    (max, t) => Math.max(max, t.views),
    0,
  );
  const hasImagesOrMemes = enrichedTweets.some((t) => t.hasMedia);

  const ctx: ScorerContext = {
    keyword,
    sampleTweets: enrichedTweets,
    totalMentions: tweetRefs.length,
    avgEngagement: Math.round(avgEngagement),
    topTweetViews,
    hasImagesOrMemes,
  };

  log.info(
    {
      keyword,
      enriched: enrichedTweets.length,
      avgEngagement: ctx.avgEngagement,
      topViews: topTweetViews,
    },
    "Trend enriched",
  );

  return ctx;
}
