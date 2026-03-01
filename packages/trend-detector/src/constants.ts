/** BullMQ queue name — must match token-launcher consumer */
export const QUEUE_NAME = "token-launch-queue";

/** Polling interval range (anti-detection randomization) */
export const POLLING_INTERVAL_MIN_MS = 30_000;
export const POLLING_INTERVAL_MAX_MS = 60_000;

/** Max trends to process per polling tick */
export const MAX_TRENDS_PER_TICK = 10;

/** Max age of a trend before it's considered stale (1 hour) */
export const MAX_TREND_AGE_MS = 60 * 60 * 1000;

/** Max concurrent fxtwitter API requests */
export const ENRICHER_CONCURRENCY = 5;

/** User-Agent for fxtwitter API requests */
export const FXTWITTER_USER_AGENT = "FlashPumpEngine/1.0";
