import { eq } from "drizzle-orm";
import {
  createLogger,
  getEnv,
  getDb,
  closeDb,
  closeRedis,
  trends,
  type LaunchSignal,
} from "@flash-pump/shared";
import { fetchTrendingKeywords } from "./scraper";
import { scoreTrend } from "./scorer";
import { applyFilters } from "./filter";
import { initQueue, publishSignal, closeQueue } from "./publisher";
import {
  POLLING_INTERVAL_MIN_MS,
  POLLING_INTERVAL_MAX_MS,
} from "./constants";

const log = createLogger("trend-detector");

/** Random sleep between min and max ms (anti-detection) */
function randomDelay(): number {
  return (
    POLLING_INTERVAL_MIN_MS +
    Math.random() * (POLLING_INTERVAL_MAX_MS - POLLING_INTERVAL_MIN_MS)
  );
}

/** Run a single detection tick */
async function tick(): Promise<void> {
  const env = getEnv();
  const db = getDb();
  const threshold = env.TREND_SCORE_THRESHOLD;

  // 1. Scrape trending keywords from X
  log.info("Fetching trending keywords...");
  let rawTrends;
  try {
    rawTrends = await fetchTrendingKeywords();
  } catch (err) {
    log.error({ err }, "Failed to fetch trending keywords, skipping tick");
    return;
  }

  if (rawTrends.length === 0) {
    log.info("No trends found this tick");
    return;
  }

  log.info({ count: rawTrends.length }, "Raw trends fetched");

  // 2. Score + filter + publish each trend
  for (const raw of rawTrends) {
    try {
      // Score with Claude AI
      const scoreResult = await scoreTrend(raw.keyword, raw.context);

      // Insert trend record into DB
      const status =
        scoreResult.score >= threshold ? "detected" : "skipped";

      const [trendRecord] = await db
        .insert(trends)
        .values({
          keyword: raw.keyword,
          score: scoreResult.score,
          context: raw.context,
          source: "x.com",
          status,
          detectedAt: raw.detectedAt,
        })
        .returning();

      if (scoreResult.score < threshold) {
        log.debug(
          { keyword: raw.keyword, score: scoreResult.score, threshold },
          "Score below threshold, skipping",
        );
        continue;
      }

      // Apply filters (duplicate + timing)
      const passes = await applyFilters(raw.keyword, raw.detectedAt);
      if (!passes) {
        await db
          .update(trends)
          .set({ status: "expired" })
          .where(eq(trends.id, trendRecord.id));
        log.info({ keyword: raw.keyword }, "Filtered out");
        continue;
      }

      // Build launch signal
      const signal: LaunchSignal = {
        keyword: raw.keyword,
        score: scoreResult.score,
        reasoning: scoreResult.reasoning,
        suggestedName: scoreResult.suggestedName,
        suggestedTicker: scoreResult.suggestedTicker,
        context: raw.context,
        imageUrls: raw.context.imageUrls ?? [],
      };

      // Publish to BullMQ queue
      await publishSignal(signal);

      // Update trend status to launched
      await db
        .update(trends)
        .set({ status: "launched" })
        .where(eq(trends.id, trendRecord.id));

      log.info(
        { keyword: raw.keyword, score: scoreResult.score, ticker: scoreResult.suggestedTicker },
        "Trend published as launch signal",
      );
    } catch (err) {
      log.error({ err, keyword: raw.keyword }, "Error processing trend");
    }
  }
}

async function main(): Promise<void> {
  log.info("Starting trend-detector");

  // Validate env early
  getEnv();

  // Initialize BullMQ queue
  initQueue();

  let running = true;

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down trend-detector...");
    running = false;
    await closeQueue();
    await closeDb();
    await closeRedis();
    log.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Main polling loop
  while (running) {
    try {
      await tick();
    } catch (err) {
      log.error({ err }, "Tick error");
    }

    // Random delay for anti-detection
    const delay = randomDelay();
    log.debug({ delayMs: Math.round(delay) }, "Sleeping until next tick");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

main().catch((err) => {
  log.fatal({ error: err }, "Fatal error");
  process.exit(1);
});
