import { Connection } from "@solana/web3.js";
import Redis from "ioredis";
import {
  createLogger,
  getEnv,
  getRedis,
  closeDb,
  closeRedis,
} from "@flash-pump/shared";
import { initWalletDeriver } from "./seller";
import {
  loadActivePositions,
  addPosition,
  runMonitorTick,
  type ExitConfig,
} from "./exit-engine";
import { aggregateDailyPnl } from "./pnl";
import {
  REDIS_CHANNELS,
  MONITOR_INTERVAL_MS,
  PNL_INTERVAL_MS,
  EXIT_DEFAULTS,
} from "./constants";

const log = createLogger("exit-manager");

async function main(): Promise<void> {
  log.info("Starting exit-manager");

  const env = getEnv();

  // Build exit config from env (with defaults)
  const exitConfig: ExitConfig = {
    stage1Multiplier: env.EXIT_STAGE1_MULTIPLIER ?? EXIT_DEFAULTS.stage1Multiplier,
    stage1BondingPct: EXIT_DEFAULTS.stage1BondingPct,
    stage2BondingPct: env.EXIT_STAGE2_BONDING_PCT ?? EXIT_DEFAULTS.stage2BondingPct,
    trailingStopPct: env.EXIT_TRAILING_STOP_PCT ?? EXIT_DEFAULTS.trailingStopPct,
    emergencyLossPct: EXIT_DEFAULTS.emergencyLossPct,
  };

  log.info({ exitConfig }, "Exit configuration loaded");

  // Initialize wallet deriver for signing sell transactions
  initWalletDeriver(env.HD_WALLET_MNEMONIC, env.WALLET_POOL_SIZE);

  // Solana RPC connection
  const connection = new Connection(env.SOLANA_RPC_URL);

  // Load existing active positions from DB
  await loadActivePositions();

  // --- Redis subscriber (separate connection for subscribe mode) ---
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

  subscriber.subscribe(REDIS_CHANNELS.TOKEN_LAUNCHED, (err, count) => {
    if (err) {
      log.error({ err }, "Failed to subscribe to Redis channel");
    } else {
      log.info({ channel: REDIS_CHANNELS.TOKEN_LAUNCHED, count }, "Subscribed to Redis");
    }
  });

  subscriber.on("message", (channel, message) => {
    if (channel === REDIS_CHANNELS.TOKEN_LAUNCHED) {
      try {
        const data = JSON.parse(message) as {
          tokenId: number;
          mintAddress: string;
          name: string;
          ticker: string;
          initialBuySol: number;
          wallet: string;
        };

        log.info(
          { tokenId: data.tokenId, name: data.name, ticker: data.ticker },
          "Received token:launched event",
        );

        addPosition({
          tokenId: data.tokenId,
          mintAddress: data.mintAddress,
          wallet: data.wallet,
          initialBuySol: data.initialBuySol,
        });
      } catch (err) {
        log.error({ err, message }, "Failed to parse token:launched message");
      }
    }
  });

  // --- Monitor loop (5-second interval) ---
  let running = true;

  const monitorLoop = async () => {
    while (running) {
      try {
        await runMonitorTick(connection, exitConfig);
      } catch (err) {
        log.error({ err }, "Monitor tick error");
      }

      // Sleep for interval
      await new Promise((resolve) => setTimeout(resolve, MONITOR_INTERVAL_MS));
    }
  };

  // Start monitor loop (non-blocking)
  const monitorPromise = monitorLoop();

  // --- Daily P&L aggregation (every 5 minutes) ---
  const pnlInterval = setInterval(async () => {
    try {
      await aggregateDailyPnl();
    } catch (err) {
      log.error({ err }, "Daily P&L aggregation error");
    }
  }, PNL_INTERVAL_MS);

  // Run initial P&L aggregation
  aggregateDailyPnl().catch((err) => {
    log.error({ err }, "Initial P&L aggregation error");
  });

  log.info(
    {
      monitorIntervalMs: MONITOR_INTERVAL_MS,
      pnlIntervalMs: PNL_INTERVAL_MS,
    },
    "Exit-manager running",
  );

  // --- Graceful shutdown ---
  const shutdown = async () => {
    log.info("Shutting down exit-manager...");
    running = false;
    clearInterval(pnlInterval);

    await subscriber.unsubscribe();
    await subscriber.quit();

    // Wait for monitor loop to finish current tick
    await monitorPromise;

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
