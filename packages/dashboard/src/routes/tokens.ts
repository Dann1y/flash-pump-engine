import { Hono } from "hono";
import { getDb, tokens, trades, trends } from "@flash-pump/shared";
import { eq, desc, sql } from "drizzle-orm";
import { layout, nav } from "../views/layout";
import {
  tokensListView,
  tokenDetailView,
  type TokenListItem,
  type TokenDetail,
  type TradeItem,
} from "../views/tokens";
import { fetchBondingCurveState } from "../services/solana";

const app = new Hono();

// Token list
app.get("/", async (c) => {
  const db = getDb();
  const filter = c.req.query("status") ?? "all";

  let query = db.select().from(tokens).orderBy(desc(tokens.launchedAt));

  let rows;
  if (filter !== "all") {
    rows = await db
      .select()
      .from(tokens)
      .where(eq(tokens.status, filter as any))
      .orderBy(desc(tokens.launchedAt));
  } else {
    rows = await query;
  }

  const tokenList: TokenListItem[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    ticker: t.ticker,
    mintAddress: t.mintAddress,
    status: t.status ?? "deploying",
    bondingProgress: t.bondingProgress ?? 0,
    initialBuySol: t.initialBuySol,
    raydiumMigrated: t.raydiumMigrated ?? false,
    launchedAt: t.launchedAt,
    createdAt: t.createdAt,
  }));

  return c.html(
    layout("Tokens", nav("tokens") + tokensListView(tokenList, filter)),
  );
});

// Token detail
app.get("/:id", async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) return c.text("Invalid token ID", 400);

  const tokenRows = await db.select().from(tokens).where(eq(tokens.id, id));
  const token = tokenRows[0];
  if (!token) return c.text("Token not found", 404);

  // Get trades for this token
  const tradeRows = await db
    .select()
    .from(trades)
    .where(eq(trades.tokenId, id))
    .orderBy(desc(trades.executedAt));

  const tradeItems: TradeItem[] = tradeRows.map((tr) => ({
    id: tr.id,
    type: tr.type ?? "buy",
    solAmount: tr.solAmount,
    tokenAmount: tr.tokenAmount,
    pricePerToken: tr.pricePerToken,
    wallet: tr.wallet,
    txSignature: tr.txSignature,
    exitStage: tr.exitStage,
    executedAt: tr.executedAt,
  }));

  // Get trend info
  let trendKeyword: string | null = null;
  let trendScore: number | null = null;
  if (token.trendId) {
    const trendRows = await db
      .select()
      .from(trends)
      .where(eq(trends.id, token.trendId));
    if (trendRows[0]) {
      trendKeyword = trendRows[0].keyword;
      trendScore = trendRows[0].score;
    }
  }

  // Try to get live bonding curve data for active tokens
  let liveBondingProgress: number | null = null;
  let livePricePerToken: number | null = null;

  if (token.status === "active" || token.status === "exiting") {
    const snapshot = await fetchBondingCurveState(token.mintAddress);
    if (snapshot) {
      liveBondingProgress = snapshot.bondingProgress;
      livePricePerToken = snapshot.pricePerToken;
    }
  }

  const detail: TokenDetail = {
    id: token.id,
    name: token.name,
    ticker: token.ticker,
    description: token.description,
    mintAddress: token.mintAddress,
    status: token.status ?? "deploying",
    bondingProgress: token.bondingProgress ?? 0,
    raydiumMigrated: token.raydiumMigrated ?? false,
    initialBuySol: token.initialBuySol,
    initialBuyTokens: token.initialBuyTokens,
    deployWallet: token.deployWallet,
    deployTx: token.deployTx,
    imageUrl: token.imageUrl,
    launchedAt: token.launchedAt,
    trendKeyword,
    trendScore,
    trades: tradeItems,
    liveBondingProgress,
    livePricePerToken,
  };

  return c.html(
    layout(`${token.name} ($${token.ticker})`, nav("tokens") + tokenDetailView(detail)),
  );
});

export default app;
