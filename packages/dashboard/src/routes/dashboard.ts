import { Hono } from "hono";
import { getDb, getEnv, tokens, dailyPnl } from "@flash-pump/shared";
import { eq, sql, and, gte } from "drizzle-orm";
import { layout, nav } from "../views/layout";
import {
  dashboardView,
  dashboardContent,
  type DashboardData,
  type ActiveTokenSummary,
} from "../views/dashboard";
import {
  getWalletBalance,
  getMultipleBalances,
  getMasterWalletAddress,
} from "../services/solana";
import { wallets } from "@flash-pump/shared";

const app = new Hono();

async function fetchDashboardData(): Promise<DashboardData> {
  const db = getDb();
  const env = getEnv();

  // Get master wallet balance
  const masterAddr = getMasterWalletAddress();
  const masterBalance = await getWalletBalance(masterAddr);

  // Get sub wallets from DB
  const subWalletRows = await db.select().from(wallets);

  // Get live balances for sub wallets
  const subAddresses = subWalletRows.map((w) => w.address);
  const balanceMap = await getMultipleBalances(subAddresses);
  const subWalletTotalBalance = Array.from(balanceMap.values()).reduce(
    (sum, b) => sum + b,
    0,
  );

  // Get active tokens
  const activeTokenRows = await db
    .select()
    .from(tokens)
    .where(
      sql`${tokens.status} IN ('active', 'deploying', 'exiting')`,
    );

  const activeTokens: ActiveTokenSummary[] = activeTokenRows.map((t) => ({
    id: t.id,
    name: t.name,
    ticker: t.ticker,
    mintAddress: t.mintAddress,
    status: t.status ?? "active",
    bondingProgress: t.bondingProgress ?? 0,
    initialBuySol: t.initialBuySol,
    launchedAt: t.launchedAt,
  }));

  // Get today's date string
  const today = new Date().toISOString().slice(0, 10);

  // Get today P&L
  const pnlRows = await db
    .select()
    .from(dailyPnl)
    .where(eq(dailyPnl.date, today));

  const todayPnl = pnlRows[0]
    ? {
        tokensLaunched: pnlRows[0].tokensLaunched ?? 0,
        tokensHit: pnlRows[0].tokensHit ?? 0,
        totalCostSol: pnlRows[0].totalCostSol ?? 0,
        totalRevenueSol: pnlRows[0].totalRevenueSol ?? 0,
        netPnlSol: pnlRows[0].netPnlSol ?? 0,
        hitRate: pnlRows[0].hitRate ?? 0,
      }
    : null;

  // Count today's launches
  const todayStart = new Date(today);
  const launchCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokens)
    .where(gte(tokens.launchedAt, todayStart));
  const todayLaunches = launchCountRows[0]?.count ?? 0;

  return {
    dryRun: env.DRY_RUN,
    todayLaunches,
    maxDailyLaunches: env.MAX_DAILY_LAUNCHES,
    masterWalletAddress: masterAddr,
    masterWalletBalance: masterBalance,
    subWalletCount: subWalletRows.filter((w) => w.isActive).length,
    subWalletTotalBalance,
    activeTokens,
    todayPnl,
  };
}

// Full page
app.get("/", async (c) => {
  const data = await fetchDashboardData();
  return c.html(layout("Dashboard", nav("dashboard") + dashboardView(data)));
});

// htmx partial for auto-refresh
app.get("/api/dashboard", async (c) => {
  const data = await fetchDashboardData();
  return c.html(dashboardContent(data));
});

export default app;
