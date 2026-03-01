import type { Bot } from "grammy";
import Redis from "ioredis";
import { eq, sql, gte } from "drizzle-orm";
import { createLogger, getDb, dailyPnl } from "@flash-pump/shared";
import { REDIS_CHANNELS, DAILY_REPORT_HOUR_UTC, DAILY_REPORT_CHECK_MS } from "./constants";
import { fmtSol, fmtPnl, fmtPct, pumpLink } from "./formatters";

const log = createLogger("alerts");

/** Redis subscriber connection (separate from shared because subscribe mode is exclusive) */
let subscriber: Redis | null = null;

/** Daily report interval handle */
let dailyReportInterval: ReturnType<typeof setInterval> | null = null;

/** Track whether today's daily report has been sent */
let lastReportDate = "";

// ─── Event Payloads ───────────────────────────────────────────────────

interface TokenLaunchedEvent {
  tokenId: number;
  mintAddress: string;
  name: string;
  ticker: string;
  initialBuySol: number;
  wallet: string;
}

interface ExitExecutedEvent {
  type: string;
  tokenId: number;
  mintAddress: string;
  stage?: number;
  solReceived?: number;
  tokensRemaining?: string;
  reason?: string;
}

interface TokenCompletedEvent {
  tokenId: number;
  mintAddress: string;
  netPnlSol: number;
}

// ─── Alert Formatters ─────────────────────────────────────────────────

function formatLaunchAlert(data: TokenLaunchedEvent): string {
  return [
    `🟢 New Token Launched`,
    "",
    `Name: ${data.name} ($${data.ticker})`,
    `Initial buy: ${fmtSol(data.initialBuySol)}`,
    `Mint: ${data.mintAddress}`,
    pumpLink(data.mintAddress),
  ].join("\n");
}

function formatExitAlert(data: ExitExecutedEvent): string {
  const isRaydium = data.type === "raydium_migration";

  if (isRaydium) {
    return [
      `🟡 Raydium Migration Detected`,
      "",
      `Token ID: ${data.tokenId}`,
      `Mint: ${data.mintAddress}`,
      pumpLink(data.mintAddress),
    ].join("\n");
  }

  return [
    `💰 Exit Stage ${data.stage} Executed`,
    "",
    `Token ID: ${data.tokenId}`,
    `SOL received: ${fmtSol(data.solReceived ?? 0)}`,
    `Reason: ${data.reason ?? "N/A"}`,
    `Remaining tokens: ${data.tokensRemaining ?? "0"}`,
    pumpLink(data.mintAddress),
  ].join("\n");
}

function formatCompletedAlert(data: TokenCompletedEvent): string {
  const emoji = data.netPnlSol >= 0 ? "✅" : "📉";
  return [
    `${emoji} Position Fully Closed`,
    "",
    `Token ID: ${data.tokenId}`,
    `Net P&L: ${fmtPnl(data.netPnlSol)}`,
    pumpLink(data.mintAddress),
  ].join("\n");
}

function formatEmergencyAlert(data: ExitExecutedEvent): string {
  return [
    `🔴 EMERGENCY EXIT`,
    "",
    `Token ID: ${data.tokenId}`,
    `SOL received: ${fmtSol(data.solReceived ?? 0)}`,
    `Reason: ${data.reason ?? "Unknown"}`,
    pumpLink(data.mintAddress),
  ].join("\n");
}

// ─── Daily Report ─────────────────────────────────────────────────────

async function sendDailyReport(bot: Bot, chatId: string): Promise<void> {
  try {
    const db = getDb();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];

    // Yesterday's P&L
    const pnlResult = await db
      .select()
      .from(dailyPnl)
      .where(eq(dailyPnl.date, yesterday))
      .limit(1);

    // Cumulative (all time)
    const cumResult = await db
      .select({
        totalCost: sql<number>`coalesce(sum(${dailyPnl.totalCostSol}), 0)::real`,
        totalRevenue: sql<number>`coalesce(sum(${dailyPnl.totalRevenueSol}), 0)::real`,
        netPnl: sql<number>`coalesce(sum(${dailyPnl.netPnlSol}), 0)::real`,
        launched: sql<number>`coalesce(sum(${dailyPnl.tokensLaunched}), 0)::int`,
        hit: sql<number>`coalesce(sum(${dailyPnl.tokensHit}), 0)::int`,
        raydium: sql<number>`coalesce(sum(${dailyPnl.tokensRaydium}), 0)::int`,
      })
      .from(dailyPnl);

    const p = pnlResult[0];
    const c = cumResult[0];

    const lines = [
      `📊 Daily Report (${yesterday})`,
      "",
      "── Yesterday ──",
      p
        ? [
            `Launched: ${p.tokensLaunched}`,
            `Hit (50%+): ${p.tokensHit}`,
            `Raydium: ${p.tokensRaydium}`,
            `Hit rate: ${fmtPct((p.hitRate ?? 0) * 100)}`,
            `Cost: ${fmtSol(p.totalCostSol ?? 0)}`,
            `Revenue: ${fmtSol(p.totalRevenueSol ?? 0)}`,
            `Net: ${fmtPnl(p.netPnlSol ?? 0)}`,
          ].join("\n")
        : "No launches yesterday",
      "",
      "── Cumulative ──",
      c
        ? [
            `Total launched: ${c.launched}`,
            `Total hit: ${c.hit}`,
            `Total Raydium: ${c.raydium}`,
            `Total cost: ${fmtSol(c.totalCost)}`,
            `Total revenue: ${fmtSol(c.totalRevenue)}`,
            `Cumulative P&L: ${fmtPnl(c.netPnl)}`,
          ].join("\n")
        : "No data",
    ];

    await bot.api.sendMessage(chatId, lines.join("\n"));
    log.info({ date: yesterday }, "Daily report sent");
  } catch (err) {
    log.error({ err }, "Failed to send daily report");
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/** Send a message to the configured chat */
export async function sendAlert(bot: Bot, chatId: string, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, {
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    log.error({ err }, "Failed to send Telegram alert");
  }
}

/** Start subscribing to Redis events and forwarding them as Telegram alerts */
export function startAlerts(bot: Bot, chatId: string): void {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const channels = Object.values(REDIS_CHANNELS);
  subscriber.subscribe(...channels).then((count) => {
    log.info({ channels, count }, "Subscribed to Redis alert channels");
  }).catch((err) => {
    log.error({ err }, "Failed to subscribe to Redis channels");
  });

  subscriber.on("message", (channel: string, message: string) => {
    try {
      const data = JSON.parse(message);
      let text: string;

      switch (channel) {
        case REDIS_CHANNELS.TOKEN_LAUNCHED:
          text = formatLaunchAlert(data as TokenLaunchedEvent);
          break;
        case REDIS_CHANNELS.TOKEN_EXIT:
          text = formatExitAlert(data as ExitExecutedEvent);
          break;
        case REDIS_CHANNELS.TOKEN_COMPLETED:
          text = formatCompletedAlert(data as TokenCompletedEvent);
          break;
        case REDIS_CHANNELS.TOKEN_EMERGENCY:
          text = formatEmergencyAlert(data as ExitExecutedEvent);
          break;
        default:
          return;
      }

      sendAlert(bot, chatId, text);
    } catch (err) {
      log.error({ err, channel, message }, "Failed to process Redis event");
    }
  });

  // Daily report check (every minute, fires at DAILY_REPORT_HOUR_UTC)
  dailyReportInterval = setInterval(() => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    if (now.getUTCHours() === DAILY_REPORT_HOUR_UTC && lastReportDate !== today) {
      lastReportDate = today;
      sendDailyReport(bot, chatId);
    }
  }, DAILY_REPORT_CHECK_MS);

  log.info("Alert system started");
}

/** Stop Redis subscriptions and daily report interval */
export async function stopAlerts(): Promise<void> {
  if (dailyReportInterval) {
    clearInterval(dailyReportInterval);
    dailyReportInterval = null;
  }

  if (subscriber) {
    await subscriber.unsubscribe();
    await subscriber.quit();
    subscriber = null;
  }

  log.info("Alert system stopped");
}
