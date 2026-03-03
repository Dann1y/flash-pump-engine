import { Hono } from "hono";
import { getDb, wallets, trades, tokens } from "@flash-pump/shared";
import { desc, eq, sql } from "drizzle-orm";
import { layout, nav } from "../views/layout";
import {
  walletsView,
  walletsContent,
  walletFlowView,
  type WalletItem,
  type WalletFlowItem,
} from "../views/wallets";
import {
  getWalletBalance,
  getMultipleBalances,
  getMasterWalletAddress,
} from "../services/solana";

const app = new Hono();

async function fetchWalletsData() {
  const db = getDb();

  // Master wallet
  const masterAddr = getMasterWalletAddress();
  const masterBalance = await getWalletBalance(masterAddr);

  // Sub wallets from DB
  const walletRows = await db.select().from(wallets);
  const addresses = walletRows.map((w) => w.address);
  const balanceMap = await getMultipleBalances(addresses);

  const subWallets: WalletItem[] = walletRows.map((w) => ({
    id: w.id,
    address: w.address,
    derivationPath: w.derivationPath,
    solBalance: w.solBalance ?? 0,
    isActive: w.isActive ?? true,
    lastUsedAt: w.lastUsedAt,
    liveBalance: balanceMap.get(w.address) ?? null,
  }));

  return {
    masterWallet: { address: masterAddr, balance: masterBalance },
    subWallets,
  };
}

// Full page
app.get("/", async (c) => {
  const { masterWallet, subWallets } = await fetchWalletsData();
  return c.html(
    layout(
      "Wallets",
      nav("wallets") + walletsView(masterWallet, subWallets),
    ),
  );
});

// htmx partial for auto-refresh (mounted at /wallets, so this becomes /wallets/partial)
app.get("/partial", async (c) => {
  const { masterWallet, subWallets } = await fetchWalletsData();
  return c.html(walletsContent(masterWallet, subWallets));
});

// Fund flow page
app.get("/flow", async (c) => {
  const db = getDb();

  // Get recent trades joined with token info
  const rows = await db
    .select({
      tokenName: tokens.name,
      tokenTicker: tokens.ticker,
      type: trades.type,
      solAmount: trades.solAmount,
      wallet: trades.wallet,
      txSignature: trades.txSignature,
      executedAt: trades.executedAt,
    })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .orderBy(desc(trades.executedAt))
    .limit(100);

  const flows: WalletFlowItem[] = rows.map((r) => ({
    tokenName: r.tokenName,
    tokenTicker: r.tokenTicker,
    type: r.type ?? "buy",
    solAmount: r.solAmount,
    wallet: r.wallet,
    txSignature: r.txSignature,
    executedAt: r.executedAt,
  }));

  return c.html(layout("Fund Flow", nav("wallets") + walletFlowView(flows)));
});

export default app;
