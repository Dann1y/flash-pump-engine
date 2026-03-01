import Redis from "ioredis";
import { createLogger } from "./logger";

const log = createLogger("redis");

let _redis: Redis | null = null;

/** General-purpose Redis connection (pub/sub, caching) */
export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    _redis = new Redis(url, { maxRetriesPerRequest: null });
    _redis.on("connect", () => log.info("Redis connected"));
    _redis.on("error", (err) => log.error({ err }, "Redis error"));
  }
  return _redis;
}

/** Create a fresh Redis connection for BullMQ (requires maxRetriesPerRequest: null) */
export function createBullMQConnection(): Redis {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return new Redis(url, { maxRetriesPerRequest: null });
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
