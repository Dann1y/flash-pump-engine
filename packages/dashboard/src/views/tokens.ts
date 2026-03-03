import { card, statusBadge, progressBar, badge } from "./layout";

export interface TokenListItem {
  id: number;
  name: string;
  ticker: string;
  mintAddress: string;
  status: string;
  bondingProgress: number;
  initialBuySol: number | null;
  raydiumMigrated: boolean;
  launchedAt: Date | null;
  createdAt: Date | null;
}

export interface TokenDetail {
  id: number;
  name: string;
  ticker: string;
  description: string | null;
  mintAddress: string;
  status: string;
  bondingProgress: number;
  raydiumMigrated: boolean;
  initialBuySol: number | null;
  initialBuyTokens: bigint | null;
  deployWallet: string;
  deployTx: string | null;
  imageUrl: string | null;
  launchedAt: Date | null;
  trendKeyword: string | null;
  trendScore: number | null;
  trades: TradeItem[];
  liveBondingProgress: number | null;
  livePricePerToken: number | null;
}

export interface TradeItem {
  id: number;
  type: string;
  solAmount: number;
  tokenAmount: bigint;
  pricePerToken: number | null;
  wallet: string;
  txSignature: string | null;
  exitStage: number | null;
  executedAt: Date | null;
}

export function tokensListView(
  tokens: TokenListItem[],
  filter: string
): string {
  const filters = ["all", "active", "exiting", "completed", "failed"];

  return `
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">Tokens</h1>
      <div class="flex gap-1">
        ${filters
          .map(
            (f) => `
          <a href="/tokens?status=${f}"
             class="px-3 py-1 rounded text-sm ${
               filter === f
                 ? "bg-gray-800 text-pump-400"
                 : "text-gray-500 hover:text-gray-300"
             }">${f}</a>`
          )
          .join("")}
      </div>
    </div>

    ${
      tokens.length === 0
        ? '<p class="text-gray-600 text-sm">No tokens found</p>'
        : `<div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 text-gray-500 text-left">
              <th class="px-4 py-3 font-medium">Token</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium">Bonding</th>
              <th class="px-4 py-3 font-medium">Cost</th>
              <th class="px-4 py-3 font-medium">Launched</th>
            </tr>
          </thead>
          <tbody>
            ${tokens.map((t) => tokenListRow(t)).join("")}
          </tbody>
        </table>
      </div>`
    }
  </div>`;
}

function tokenListRow(t: TokenListItem): string {
  const launched = t.launchedAt
    ? t.launchedAt.toISOString().replace("T", " ").slice(0, 16)
    : "—";
  return `
  <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
      onclick="window.location='/tokens/${t.id}'">
    <td class="px-4 py-3">
      <span class="font-medium">${t.name}</span>
      <span class="text-gray-500 ml-1">$${t.ticker}</span>
      <p class="text-xs text-gray-600 mt-0.5 font-mono">${truncAddr(t.mintAddress)}</p>
    </td>
    <td class="px-4 py-3">
      ${statusBadge(t.status)}
      ${t.raydiumMigrated ? badge("Raydium", "green") : ""}
    </td>
    <td class="px-4 py-3">
      <div class="w-24">
        ${progressBar(t.bondingProgress)}
        <p class="text-xs text-gray-500 mt-1">${t.bondingProgress.toFixed(1)}%</p>
      </div>
    </td>
    <td class="px-4 py-3 text-gray-400">${t.initialBuySol?.toFixed(3) ?? "—"} SOL</td>
    <td class="px-4 py-3 text-gray-500 text-xs">${launched}</td>
  </tr>`;
}

export function tokenDetailView(t: TokenDetail): string {
  const pumpfunLink = `https://pump.fun/coin/${t.mintAddress}`;
  const solscanLink = `https://solscan.io/token/${t.mintAddress}`;

  const totalBuySol = t.trades
    .filter((tr) => tr.type === "buy")
    .reduce((sum, tr) => sum + tr.solAmount, 0);
  const totalSellSol = t.trades
    .filter((tr) => tr.type === "sell")
    .reduce((sum, tr) => sum + tr.solAmount, 0);
  const netPnl = totalSellSol - totalBuySol;
  const pnlColor = netPnl >= 0 ? "text-green-400" : "text-red-400";

  const bondingPct = t.liveBondingProgress ?? t.bondingProgress;

  return `
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-6">
    <div class="flex items-center gap-3">
      <a href="/tokens" class="text-gray-500 hover:text-gray-300">&larr;</a>
      <h1 class="text-xl font-bold">${t.name}</h1>
      <span class="text-gray-500">$${t.ticker}</span>
      ${statusBadge(t.status)}
      ${t.raydiumMigrated ? badge("Raydium", "green") : ""}
    </div>

    <!-- Overview -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${card(
        "Bonding Curve",
        `${progressBar(bondingPct)}
         <p class="text-lg font-bold mt-2">${bondingPct.toFixed(1)}%</p>
         ${t.livePricePerToken != null ? `<p class="text-xs text-gray-500">Price: ${t.livePricePerToken.toFixed(10)} SOL</p>` : ""}
         <p class="text-xs text-gray-600 mt-1">${t.status === "active" || t.status === "exiting" ? "Live from chain" : "Last known"}</p>`
      )}
      ${card(
        "P&L",
        `<p class="text-2xl font-bold ${pnlColor}">${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(4)} SOL</p>
         <div class="grid grid-cols-2 gap-2 mt-2 text-sm">
           <div><p class="text-gray-500">Buy</p><p class="text-gray-300">${totalBuySol.toFixed(4)} SOL</p></div>
           <div><p class="text-gray-500">Sell</p><p class="text-gray-300">${totalSellSol.toFixed(4)} SOL</p></div>
         </div>`
      )}
      ${card(
        "Details",
        `<div class="space-y-2 text-sm">
           <div><span class="text-gray-500">Mint:</span> <span class="font-mono text-xs">${t.mintAddress}</span></div>
           <div><span class="text-gray-500">Wallet:</span> <span class="font-mono text-xs">${truncAddr(t.deployWallet)}</span></div>
           ${t.trendKeyword ? `<div><span class="text-gray-500">Trend:</span> ${t.trendKeyword} (${(t.trendScore ?? 0).toFixed(2)})</div>` : ""}
           <div class="flex gap-2 mt-2">
             <a href="${pumpfunLink}" target="_blank" class="text-pump-400 hover:underline text-xs">pump.fun</a>
             <a href="${solscanLink}" target="_blank" class="text-blue-400 hover:underline text-xs">Solscan</a>
           </div>
         </div>`
      )}
    </div>

    ${t.description ? `<p class="text-gray-500 text-sm">${t.description}</p>` : ""}

    <!-- Trades -->
    ${card(
      `Trades (${t.trades.length})`,
      t.trades.length === 0
        ? '<p class="text-gray-600 text-sm">No trades</p>'
        : `<table class="w-full text-sm">
          <thead>
            <tr class="text-gray-500 text-left border-b border-gray-800">
              <th class="pb-2 font-medium">Type</th>
              <th class="pb-2 font-medium">SOL</th>
              <th class="pb-2 font-medium">Stage</th>
              <th class="pb-2 font-medium">Tx</th>
              <th class="pb-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            ${t.trades.map((tr) => tradeRow(tr)).join("")}
          </tbody>
        </table>`
    )}
  </div>`;
}

function tradeRow(tr: TradeItem): string {
  const typeColor = tr.type === "buy" ? "text-green-400" : "text-red-400";
  const txLink = tr.txSignature
    ? `<a href="https://solscan.io/tx/${tr.txSignature}" target="_blank" class="text-blue-400 hover:underline font-mono">${tr.txSignature.slice(0, 8)}...</a>`
    : "—";
  const time = tr.executedAt
    ? tr.executedAt.toISOString().replace("T", " ").slice(0, 19)
    : "—";

  return `
  <tr class="border-b border-gray-800/30">
    <td class="py-2 ${typeColor} font-medium">${tr.type.toUpperCase()}</td>
    <td class="py-2 text-gray-300">${tr.solAmount.toFixed(4)}</td>
    <td class="py-2 text-gray-500">${tr.exitStage ?? "—"}</td>
    <td class="py-2 text-xs">${txLink}</td>
    <td class="py-2 text-gray-600 text-xs">${time}</td>
  </tr>`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
