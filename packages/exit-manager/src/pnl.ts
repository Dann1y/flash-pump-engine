import { eq, and, sql, gte, lte } from "drizzle-orm";
import { createLogger, getDb, tokens, trades, dailyPnl } from "@flash-pump/shared";

const log = createLogger("pnl");

export interface TokenPnl {
  tokenId: number;
  totalBuySol: number;
  totalSellSol: number;
  netPnlSol: number;
}

/** Calculate P&L for a single token from its trade records */
export async function calculateTokenPnl(tokenId: number): Promise<TokenPnl> {
  const db = getDb();

  const buyResult = await db
    .select({ sum: sql<number>`coalesce(sum(${trades.solAmount}), 0)::real` })
    .from(trades)
    .where(and(eq(trades.tokenId, tokenId), eq(trades.type, "buy")));

  const sellResult = await db
    .select({ sum: sql<number>`coalesce(sum(${trades.solAmount}), 0)::real` })
    .from(trades)
    .where(and(eq(trades.tokenId, tokenId), eq(trades.type, "sell")));

  const totalBuySol = buyResult[0]?.sum ?? 0;
  const totalSellSol = sellResult[0]?.sum ?? 0;
  const netPnlSol = totalSellSol - totalBuySol;

  return { tokenId, totalBuySol, totalSellSol, netPnlSol };
}

/** Aggregate daily P&L and upsert into daily_pnl table */
export async function aggregateDailyPnl(date?: string): Promise<void> {
  const db = getDb();
  const targetDate = date ?? new Date().toISOString().split("T")[0];

  log.info({ date: targetDate }, "Aggregating daily P&L");

  // Count tokens launched today
  const launchedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokens)
    .where(sql`${tokens.launchedAt}::date = ${targetDate}`);
  const tokensLaunched = launchedResult[0]?.count ?? 0;

  // Count tokens that hit bonding 50%+
  const hitResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokens)
    .where(
      and(
        sql`${tokens.launchedAt}::date = ${targetDate}`,
        gte(tokens.bondingProgress, 50),
      ),
    );
  const tokensHit = hitResult[0]?.count ?? 0;

  // Count tokens that reached Raydium
  const raydiumResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokens)
    .where(
      and(
        sql`${tokens.launchedAt}::date = ${targetDate}`,
        eq(tokens.raydiumMigrated, true),
      ),
    );
  const tokensRaydium = raydiumResult[0]?.count ?? 0;

  // Sum all buy costs for tokens launched today
  const costResult = await db
    .select({ sum: sql<number>`coalesce(sum(${trades.solAmount}), 0)::real` })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(
      and(
        sql`${tokens.launchedAt}::date = ${targetDate}`,
        eq(trades.type, "buy"),
      ),
    );
  const totalCostSol = costResult[0]?.sum ?? 0;

  // Sum all sell revenue for tokens launched today
  const revenueResult = await db
    .select({ sum: sql<number>`coalesce(sum(${trades.solAmount}), 0)::real` })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(
      and(
        sql`${tokens.launchedAt}::date = ${targetDate}`,
        eq(trades.type, "sell"),
      ),
    );
  const totalRevenueSol = revenueResult[0]?.sum ?? 0;

  const netPnlSol = totalRevenueSol - totalCostSol;
  const hitRate = tokensLaunched > 0 ? tokensHit / tokensLaunched : 0;

  // Upsert (idempotent)
  await db
    .insert(dailyPnl)
    .values({
      date: targetDate,
      tokensLaunched,
      tokensHit,
      tokensRaydium,
      totalCostSol,
      totalRevenueSol,
      netPnlSol,
      hitRate,
    })
    .onConflictDoUpdate({
      target: dailyPnl.date,
      set: {
        tokensLaunched,
        tokensHit,
        tokensRaydium,
        totalCostSol,
        totalRevenueSol,
        netPnlSol,
        hitRate,
      },
    });

  log.info(
    { date: targetDate, tokensLaunched, tokensHit, tokensRaydium, netPnlSol, hitRate },
    "Daily P&L aggregated",
  );
}
