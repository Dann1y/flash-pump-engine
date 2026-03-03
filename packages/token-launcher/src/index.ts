import { Worker, type Job } from "bullmq";
import { sql, eq } from "drizzle-orm";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
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

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Derive the Associated Token Account address for a wallet + mint (tries both Token and Token2022) */
function getAssociatedTokenAddresses(walletPubkey: PublicKey, mintPubkey: PublicKey): PublicKey[] {
  return [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID].map((tokenProgram) => {
    const [ata] = PublicKey.findProgramAddressSync(
      [walletPubkey.toBuffer(), tokenProgram.toBuffer(), mintPubkey.toBuffer()],
      ATA_PROGRAM_ID,
    );
    return ata;
  });
}

/** Query on-chain token balance for a wallet's ATA after bundle lands (checks both Token programs) */
async function queryTokenBalance(
  connection: Connection,
  walletAddress: string,
  mintAddress: string,
  maxRetries = 5,
): Promise<bigint> {
  const walletPubkey = new PublicKey(walletAddress);
  const mintPubkey = new PublicKey(mintAddress);
  const atas = getAssociatedTokenAddresses(walletPubkey, mintPubkey);

  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    for (const ata of atas) {
      try {
        const accountInfo = await connection.getTokenAccountBalance(ata);
        const amount = BigInt(accountInfo.value.amount);
        if (amount > BigInt(0)) {
          log.info({ ata: ata.toBase58(), amount: amount.toString() }, "Token balance fetched");
          return amount;
        }
      } catch {
        // ATA doesn't exist for this token program, try next
      }
    }
    log.debug({ attempt: i + 1 }, "Token account not yet available, retrying...");
  }

  log.warn({ walletAddress, mintAddress }, "Could not fetch token balance after retries");
  return BigInt(0);
}

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

  // 5. Generate mint keypair (reused across retries — same token address)
  const mintKeypair = Keypair.generate();
  const mintAddress = mintKeypair.publicKey.toBase58();
  const deployerKeypair = getKeypairByAddress(wallet.address);

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
    // 7. Deploy + bundle with retry (fresh PumpPortal txs each attempt for new blockhash)
    const MAX_DEPLOY_ATTEMPTS = 3;
    let bundleResult: Awaited<ReturnType<typeof submitBundle>> | null = null;

    for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
      try {
        log.info({ attempt, maxAttempts: MAX_DEPLOY_ATTEMPTS }, "Building deploy txs (fresh blockhash)");

        const deployResult = await buildDeployTransaction({
          deployerAddress: wallet.address,
          name: metadata.name,
          ticker: metadata.ticker,
          description: metadata.description,
          metadataUri,
          initialBuySol,
        }, mintKeypair);

        const result = await submitBundle({
          txsBase58: deployResult.txsBase58,
          mintKeypair,
          deployerKeypair,
        });

        if (result.status === "Landed") {
          bundleResult = result;
          break;
        }

        log.warn({ attempt, bundleId: result.bundleId }, "Bundle failed to land, retrying with fresh txs");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_DEPLOY_ATTEMPTS) {
          const delay = 2000 * attempt;
          log.warn({ attempt, error: errMsg, delay }, "Deploy+bundle failed, retrying...");
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }

    if (!bundleResult || bundleResult.status !== "Landed") {
      throw new Error("Bundle failed after all attempts");
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
    // In DRY_RUN: fake token amount. In production: query on-chain balance.
    let buyTokenAmount: bigint;
    if (getEnv().DRY_RUN) {
      buyTokenAmount = BigInt(1_000_000_000);
    } else {
      const connection = new Connection(env.SOLANA_RPC_URL);
      buyTokenAmount = await queryTokenBalance(connection, wallet.address, mintAddress);
      log.info({ mintAddress, buyTokenAmount: buyTokenAmount.toString() }, "Initial buy tokens acquired");
    }

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
