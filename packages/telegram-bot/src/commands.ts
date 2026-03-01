import type { Bot, CommandContext, Context } from "grammy";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import {
  createLogger,
  getDb,
  getEnv,
  tokens,
  wallets,
  dailyPnl,
  trades,
} from "@flash-pump/shared";
import { fmtSol, fmtPct, fmtPnl, pumpLink, statusEmoji } from "./formatters";

const log = createLogger("commands");

/** Global pause flag — when true, trend-detector queue is effectively paused */
let paused = false;

export function isPaused(): boolean {
  return paused;
}

/** Register all command handlers on the bot */
export function registerCommands(bot: Bot): void {
  bot.command("status", handleStatus);
  bot.command("pnl", handlePnl);
  bot.command("tokens", handleTokens);
  bot.command("pause", handlePause);
  bot.command("resume", handleResume);
  bot.command("config", handleConfig);
  bot.command("start", (ctx) => ctx.reply(
    "Flash Pump Engine Bot\n\nCommands:\n" +
    "/status — System status\n" +
    "/pnl — P&L summary\n" +
    "/tokens — Recent tokens\n" +
    "/pause — Pause launches\n" +
    "/resume — Resume launches\n" +
    "/config — View config",
  ));
}

/** /status — System status */
async function handleStatus(ctx: CommandContext<Context>): Promise<void> {
  try {
    const db = getDb();

    // Active tokens
    const activeResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tokens)
      .where(eq(tokens.status, "active"));
    const activeCount = activeResult[0]?.count ?? 0;

    // Deploying tokens
    const deployingResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tokens)
      .where(eq(tokens.status, "deploying"));
    const deployingCount = deployingResult[0]?.count ?? 0;

    // Today's launches
    const today = new Date().toISOString().split("T")[0];
    const todayResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tokens)
      .where(sql`${tokens.launchedAt}::date = ${today}`);
    const todayLaunches = todayResult[0]?.count ?? 0;

    // Total wallet balance
    const balanceResult = await db
      .select({ sum: sql<number>`coalesce(sum(${wallets.solBalance}), 0)::real` })
      .from(wallets)
      .where(eq(wallets.isActive, true));
    const totalBalance = balanceResult[0]?.sum ?? 0;

    // Active wallets
    const walletResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wallets)
      .where(eq(wallets.isActive, true));
    const walletCount = walletResult[0]?.count ?? 0;

    const env = getEnv();
    const statusText = [
      "📊 System Status",
      "",
      `Active tokens: ${activeCount}`,
      `Deploying: ${deployingCount}`,
      `Today's launches: ${todayLaunches} / ${env.MAX_DAILY_LAUNCHES}`,
      "",
      `Wallets: ${walletCount} active`,
      `Total balance: ${fmtSol(totalBalance)}`,
      "",
      `Paused: ${paused ? "Yes ⏸️" : "No ▶️"}`,
    ].join("\n");

    await ctx.reply(statusText);
  } catch (err) {
    log.error({ err }, "/status error");
    await ctx.reply("Error fetching status");
  }
}

/** /pnl — P&L summary (today, 7d, 30d) */
async function handlePnl(ctx: CommandContext<Context>): Promise<void> {
  try {
    const db = getDb();
    const today = new Date().toISOString().split("T")[0];

    // Today's P&L
    const todayPnl = await db
      .select()
      .from(dailyPnl)
      .where(eq(dailyPnl.date, today))
      .limit(1);

    // Last 7 days aggregated
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
    const weekResult = await db
      .select({
        totalCost: sql<number>`coalesce(sum(${dailyPnl.totalCostSol}), 0)::real`,
        totalRevenue: sql<number>`coalesce(sum(${dailyPnl.totalRevenueSol}), 0)::real`,
        netPnl: sql<number>`coalesce(sum(${dailyPnl.netPnlSol}), 0)::real`,
        launched: sql<number>`coalesce(sum(${dailyPnl.tokensLaunched}), 0)::int`,
        hit: sql<number>`coalesce(sum(${dailyPnl.tokensHit}), 0)::int`,
      })
      .from(dailyPnl)
      .where(gte(dailyPnl.date, weekAgo));

    // Last 30 days aggregated
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
    const monthResult = await db
      .select({
        totalCost: sql<number>`coalesce(sum(${dailyPnl.totalCostSol}), 0)::real`,
        totalRevenue: sql<number>`coalesce(sum(${dailyPnl.totalRevenueSol}), 0)::real`,
        netPnl: sql<number>`coalesce(sum(${dailyPnl.netPnlSol}), 0)::real`,
        launched: sql<number>`coalesce(sum(${dailyPnl.tokensLaunched}), 0)::int`,
        hit: sql<number>`coalesce(sum(${dailyPnl.tokensHit}), 0)::int`,
      })
      .from(dailyPnl)
      .where(gte(dailyPnl.date, monthAgo));

    const tp = todayPnl[0];
    const w = weekResult[0];
    const m = monthResult[0];

    const lines = [
      "💰 P&L Summary",
      "",
      "── Today ──",
      tp
        ? [
            `Launched: ${tp.tokensLaunched}`,
            `Hit (50%+): ${tp.tokensHit}`,
            `Hit rate: ${fmtPct((tp.hitRate ?? 0) * 100)}`,
            `Cost: ${fmtSol(tp.totalCostSol ?? 0)}`,
            `Revenue: ${fmtSol(tp.totalRevenueSol ?? 0)}`,
            `Net: ${fmtPnl(tp.netPnlSol ?? 0)}`,
          ].join("\n")
        : "No data yet",
      "",
      "── 7 Days ──",
      w
        ? [
            `Launched: ${w.launched}`,
            `Hit: ${w.hit}`,
            `Cost: ${fmtSol(w.totalCost)}`,
            `Revenue: ${fmtSol(w.totalRevenue)}`,
            `Net: ${fmtPnl(w.netPnl)}`,
          ].join("\n")
        : "No data",
      "",
      "── 30 Days ──",
      m
        ? [
            `Launched: ${m.launched}`,
            `Hit: ${m.hit}`,
            `Cost: ${fmtSol(m.totalCost)}`,
            `Revenue: ${fmtSol(m.totalRevenue)}`,
            `Net: ${fmtPnl(m.netPnl)}`,
          ].join("\n")
        : "No data",
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    log.error({ err }, "/pnl error");
    await ctx.reply("Error fetching P&L");
  }
}

/** /tokens — Recent launched tokens (last 10) */
async function handleTokens(ctx: CommandContext<Context>): Promise<void> {
  try {
    const db = getDb();

    const recentTokens = await db
      .select()
      .from(tokens)
      .orderBy(desc(tokens.launchedAt))
      .limit(10);

    if (recentTokens.length === 0) {
      await ctx.reply("No tokens launched yet.");
      return;
    }

    const lines = ["🪙 Recent Tokens", ""];

    for (const t of recentTokens) {
      const emoji = statusEmoji(t.status ?? "");
      const bonding = t.bondingProgress != null ? fmtPct(t.bondingProgress) : "N/A";

      // Get P&L for this token
      const buySum = await db
        .select({ sum: sql<number>`coalesce(sum(${trades.solAmount}), 0)::real` })
        .from(trades)
        .where(and(eq(trades.tokenId, t.id), eq(trades.type, "buy")));
      const sellSum = await db
        .select({ sum: sql<number>`coalesce(sum(${trades.solAmount}), 0)::real` })
        .from(trades)
        .where(and(eq(trades.tokenId, t.id), eq(trades.type, "sell")));

      const cost = buySum[0]?.sum ?? 0;
      const revenue = sellSum[0]?.sum ?? 0;
      const pnl = revenue - cost;

      lines.push(
        `${emoji} ${t.name} ($${t.ticker})`,
        `   Bonding: ${bonding} | PnL: ${fmtPnl(pnl)}`,
        `   ${pumpLink(t.mintAddress)}`,
        "",
      );
    }

    await ctx.reply(lines.join("\n"), { link_preview_options: { is_disabled: true } });
  } catch (err) {
    log.error({ err }, "/tokens error");
    await ctx.reply("Error fetching tokens");
  }
}

/** /pause — Pause new launches */
async function handlePause(ctx: CommandContext<Context>): Promise<void> {
  if (paused) {
    await ctx.reply("Already paused ⏸️");
    return;
  }
  paused = true;
  log.info("Launches paused via /pause");
  await ctx.reply("⏸️ New launches paused. Existing exits will continue.\nUse /resume to restart.");
}

/** /resume — Resume launches */
async function handleResume(ctx: CommandContext<Context>): Promise<void> {
  if (!paused) {
    await ctx.reply("Already running ▶️");
    return;
  }
  paused = false;
  log.info("Launches resumed via /resume");
  await ctx.reply("▶️ Launches resumed!");
}

/** /config — View current config */
async function handleConfig(ctx: CommandContext<Context>): Promise<void> {
  try {
    const env = getEnv();
    const lines = [
      "⚙️ Configuration",
      "",
      `Score threshold: ${env.TREND_SCORE_THRESHOLD}`,
      `Initial buy: ${fmtSol(env.INITIAL_BUY_SOL)}`,
      `Max daily launches: ${env.MAX_DAILY_LAUNCHES}`,
      `Exit stage 1 multiplier: ${env.EXIT_STAGE1_MULTIPLIER}x`,
      `Exit stage 2 bonding: ${fmtPct(env.EXIT_STAGE2_BONDING_PCT)}`,
      `Trailing stop: ${fmtPct(env.EXIT_TRAILING_STOP_PCT)}`,
      `Wallet pool size: ${env.WALLET_POOL_SIZE}`,
      `Wallet cooldown: ${env.WALLET_COOLDOWN_MINUTES} min`,
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    log.error({ err }, "/config error");
    await ctx.reply("Error fetching config");
  }
}
