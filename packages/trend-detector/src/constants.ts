/** BullMQ queue name — must match token-launcher consumer */
export const QUEUE_NAME = "token-launch-queue";

/** X API v2 base URL */
export const X_API_BASE_URL = "https://api.twitter.com/2";

/** Polling interval range (anti-detection randomization) */
export const POLLING_INTERVAL_MIN_MS = 30_000;
export const POLLING_INTERVAL_MAX_MS = 60_000;

/** Max trends to process per polling tick */
export const MAX_TRENDS_PER_TICK = 10;

/** Max age of a trend before it's considered stale (1 hour) */
export const MAX_TREND_AGE_MS = 60 * 60 * 1000;

/** X API Recent Search query for crypto/meme trends */
export const X_SEARCH_QUERY =
  "(crypto OR memecoin OR $SOL OR pump.fun) -is:retweet lang:en";
