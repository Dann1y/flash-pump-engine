import { createLogger } from "@flash-pump/shared";

const log = createLogger("retry");

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms (default: 1000) */
  baseDelayMs?: number;
  /** Max delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Label for logging */
  label?: string;
}

/**
 * Exponential backoff with jitter.
 * Retries the given function up to maxAttempts times.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    label = "operation",
  } = opts;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) break;

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxDelayMs,
      );
      log.warn(
        { attempt, maxAttempts, delay: Math.round(delay), error: lastError.message },
        `${label} failed, retrying...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
