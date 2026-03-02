/**
 * Inject a fake LaunchSignal into BullMQ — bypasses trend-detector.
 *
 * Usage:
 *   pnpm tsx scripts/inject-test-signal.ts
 *   pnpm tsx scripts/inject-test-signal.ts "DOGE2MOON"
 */

import { Queue } from "bullmq";
import type { LaunchSignal } from "@flash-pump/shared";

const QUEUE_NAME = "token-launch-queue";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const keyword = process.argv[2] || "TestMoon";

const signal: LaunchSignal = {
  keyword,
  score: 0.85,
  reasoning: "Injected test signal for E2E dry-run verification",
  suggestedName: `${keyword} Coin`,
  suggestedTicker: keyword.slice(0, 6).toUpperCase(),
  context: {
    source: "inject-test-signal",
    injectedAt: new Date().toISOString(),
  },
  imageUrls: [],
};

async function main() {
  const queue = new Queue<LaunchSignal>(QUEUE_NAME, {
    connection: { url: redisUrl },
  });

  const job = await queue.add("launch", signal, {
    attempts: 3,
    backoff: { type: "exponential", delay: 60000 },
  });

  console.log(`✅ Injected test signal into queue "${QUEUE_NAME}"`);
  console.log(`   Job ID:  ${job.id}`);
  console.log(`   Keyword: ${signal.keyword}`);
  console.log(`   Ticker:  ${signal.suggestedTicker}`);
  console.log(`   Score:   ${signal.score}`);

  await queue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to inject signal:", err);
  process.exit(1);
});
