import { execFile } from "node:child_process";
import path from "node:path";
import { createLogger, type TweetRef } from "@flash-pump/shared";
import { withRetry } from "./retry";
import { MAX_TRENDS_PER_TICK } from "./constants";

const log = createLogger("scraper");

/** Raw trend extracted from Playwright scraping */
export interface RawTrend {
  keyword: string;
  detectedAt: Date;
  tweetRefs: TweetRef[];
  context: {
    tweetCount: number;
    sampleTweets: string[];
    imageUrls: string[];
    mentionCount: number;
  };
}

/** JSON shape emitted by the Python Playwright scraper */
interface ScraperOutput {
  trends: Array<{
    keyword: string;
    tweet_count: number;
    sample_tweets: string[];
    image_urls: string[];
    mention_count: number;
    tweet_refs: Array<{ tweet_id: string; screen_name: string }>;
  }>;
}

/** Spawn the Python Playwright scraper and parse its JSON stdout */
function runPythonScraper(): Promise<ScraperOutput> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(
      __dirname,
      "../../../python/x-scraper/scraper.py",
    );

    log.debug({ scriptPath }, "Spawning Python scraper");

    const child = execFile(
      "python3",
      [scriptPath, "--json"],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          log.error({ error: error.message, stderr }, "Python scraper failed");
          return reject(error);
        }

        if (stderr) {
          log.debug({ stderr }, "Python scraper stderr");
        }

        try {
          const parsed = JSON.parse(stdout) as ScraperOutput;
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`Failed to parse scraper output: ${stdout.slice(0, 500)}`));
        }
      },
    );

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Python scraper: ${err.message}`));
    });
  });
}

/** Fetch trending keywords via Playwright scraping */
export async function fetchTrendingKeywords(): Promise<RawTrend[]> {
  return withRetry(
    async () => {
      const output = await runPythonScraper();

      if (!output.trends || output.trends.length === 0) {
        log.info("No trends returned from scraper");
        return [];
      }

      const now = new Date();

      const trends = output.trends
        .slice(0, MAX_TRENDS_PER_TICK)
        .filter((t) => t.tweet_count >= 2)
        .map((t) => ({
          keyword: t.keyword,
          detectedAt: now,
          tweetRefs: t.tweet_refs.map((ref) => ({
            tweetId: ref.tweet_id,
            screenName: ref.screen_name,
          })),
          context: {
            tweetCount: t.tweet_count,
            sampleTweets: t.sample_tweets,
            imageUrls: t.image_urls,
            mentionCount: t.mention_count,
          },
        }));

      log.info(
        { trendCount: trends.length, totalRefs: trends.reduce((s, t) => s + t.tweetRefs.length, 0) },
        "Fetched trending keywords via Playwright",
      );

      return trends;
    },
    { maxAttempts: 3, label: "fetchTrendingKeywords" },
  );
}
