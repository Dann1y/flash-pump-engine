import { Queue } from "bullmq";
import { createLogger, type LaunchSignal } from "@flash-pump/shared";
import { QUEUE_NAME } from "./constants";

const log = createLogger("publisher");

let queue: Queue<LaunchSignal> | null = null;

/** Initialize the BullMQ queue producer */
export function initQueue(): Queue<LaunchSignal> {
  if (!queue) {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    queue = new Queue<LaunchSignal>(QUEUE_NAME, {
      connection: { url: redisUrl },
    });
    log.info({ queue: QUEUE_NAME }, "BullMQ queue initialized");
  }
  return queue;
}

/** Publish a launch signal to the queue */
export async function publishSignal(signal: LaunchSignal): Promise<void> {
  const q = initQueue();

  const job = await q.add("launch", signal, {
    attempts: 3,
    backoff: { type: "exponential", delay: 60000 },
  });

  log.info(
    {
      jobId: job.id,
      keyword: signal.keyword,
      score: signal.score,
      ticker: signal.suggestedTicker,
    },
    "Launch signal published to queue",
  );
}

/** Close the queue connection (for graceful shutdown) */
export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
    log.info("Queue closed");
  }
}
