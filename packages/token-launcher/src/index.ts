import { Worker, type Job } from "bullmq";
import { sql, eq } from "drizzle-orm";
import {
  createLogger,
  getDb,
  getEnv,
  getRedis,
  closeDb,
  closeRedis,
  tokens,
  trades,
  type LaunchSignal,
} from "@flash-pump/shared";
import { QUEUE_NAME, ANTI_DETECTION } from "./constants";
import { initWalletPool, getAvailableWallet, markWalletUsed, getKeypairByAddress } from "./wallet-pool";
import { generateMetadata } from "./metadata";
import { generateAndUploadImage } from "./image-gen";
import { buildDeployTransaction, randomizeBuyAmount } from "./deployer";
import { submitBundle } from "./bundler";

const log = createLogger("token-launcher");

/** Check how many tokens were launched today */
async function getDailyLaunchCount(): Promise<number> {
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokens)
    .where(sql`${tokens.launchedAt}::date = ${today}`);

  return result[0]?.count ?? 0;
}

/** Process a single launch signal */
async function processLaunch(job: Job<LaunchSignal>): Promise<void> {
  const signal = job.data;
  const env = getEnv();
  const db = getDb();

  log.info({ keyword: signal.keyword, score: signal.score, jobId: job.id }, "Processing launch signal");

  // 1. Check daily limit
  const dailyCount = await getDailyLaunchCount();
  if (dailyCount >= env.MAX_DAILY_LAUNCHES) {
    log.warn({ dailyCount, max: env.MAX_DAILY_LAUNCHES }, "Daily launch limit reached, skipping");
    return;
  }

  // 2. Generate metadata
  log.info("Generating token metadata");
  const metadata = await generateMetadata(signal);

  // 3. Generate and upload image
  log.info("Generating token image");
  const { metadataUri } = await generateAndUploadImage(
    signal,
    metadata.name,
    metadata.ticker,
    metadata.description,
  );

  // 4. Get available wallet
  const initialBuySol = randomizeBuyAmount();
  const totalNeeded = initialBuySol + ANTI_DETECTION.maxTipSol + 0.01; // buy + tip + rent/fees
  const wallet = await getAvailableWallet(totalNeeded);

  // 5. Build deploy transaction
  const { mintKeypair, createTxBase64 } = await buildDeployTransaction({
    deployerAddress: wallet.address,
    name: metadata.name,
    ticker: metadata.ticker,
    description: metadata.description,
    metadataUri,
    initialBuySol,
  });

  const mintAddress = mintKeypair.publicKey.toBase58();

  // 6. Insert token record (status: deploying)
  const [tokenRecord] = await db
    .insert(tokens)
    .values({
      mintAddress,
      name: metadata.name,
      ticker: metadata.ticker,
      description: metadata.description,
      imageUrl: metadataUri,
      deployWallet: wallet.address,
      initialBuySol,
      status: "deploying",
    })
    .returning();

  try {
    // 7. Submit Jito bundle
    const deployerKeypair = getKeypairByAddress(wallet.address);
    const bundleResult = await submitBundle({
      createTxBase64,
      mintKeypair,
      deployerKeypair,
    });

    if (bundleResult.status !== "Landed") {
      throw new Error(`Bundle failed: ${bundleResult.bundleId}`);
    }

    // 8. Update token status to active
    await db
      .update(tokens)
      .set({
        status: "active",
        deployTx: bundleResult.bundleId,
      })
      .where(eq(tokens.id, tokenRecord.id));

    // 9. Record the initial buy trade
    // In DRY_RUN mode, use a fake token amount (~1000 tokens at 6 decimals)
    // so exit-manager can track the position (it skips positions with 0 tokens)
    const buyTokenAmount = getEnv().DRY_RUN ? BigInt(1_000_000_000) : BigInt(0);
    await db.insert(trades).values({
      tokenId: tokenRecord.id,
      type: "buy",
      solAmount: initialBuySol,
      tokenAmount: buyTokenAmount,
      wallet: wallet.address,
      txSignature: bundleResult.bundleId,
    });

    // 10. Mark wallet as used (cooldown starts)
    await markWalletUsed(wallet.address);

    // 11. Publish event for other modules (exit-manager, telegram-bot)
    const redis = getRedis();
    await redis.publish(
      "token:launched",
      JSON.stringify({
        tokenId: tokenRecord.id,
        mintAddress,
        name: metadata.name,
        ticker: metadata.ticker,
        initialBuySol,
        wallet: wallet.address,
      }),
    );

    log.info(
      {
        tokenId: tokenRecord.id,
        mint: mintAddress,
        name: metadata.name,
        ticker: metadata.ticker,
        buySol: initialBuySol,
        bundleId: bundleResult.bundleId,
      },
      "Token launched successfully",
    );
  } catch (err) {
    // Mark token as failed
    await db
      .update(tokens)
      .set({ status: "failed" })
      .where(eq(tokens.id, tokenRecord.id));
    throw err;
  }
}

/** Start the BullMQ worker */
async function main(): Promise<void> {
  log.info("Starting token-launcher worker");

  const env = getEnv();

  // Initialize wallet pool
  await initWalletPool();

  // Create BullMQ worker with URL string (avoids ioredis version mismatch)
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const worker = new Worker<LaunchSignal>(QUEUE_NAME, processLaunch, {
    connection: { url: redisUrl },
    concurrency: 1,
    limiter: {
      max: 1,
      duration: ANTI_DETECTION.minLaunchIntervalSec * 1000,
    },
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        // Exponential backoff: 1m, 2m, 4m
        return Math.min(60000 * Math.pow(2, attemptsMade - 1), 240000);
      },
    },
  });

  worker.on("completed", (job) => {
    log.info({ jobId: job?.id }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, error: err.message }, "Job failed");
  });

  worker.on("error", (err) => {
    log.error({ error: err.message }, "Worker error");
  });

  log.info({ queue: QUEUE_NAME }, "Worker listening for launch signals");

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down worker...");
    await worker.close();
    await closeDb();
    await closeRedis();
    log.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.fatal({ error: err }, "Fatal error");
  process.exit(1);
});
