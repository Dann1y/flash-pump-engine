import { card, stat, statusBadge, progressBar } from "./layout";

export interface DashboardData {
  dryRun: boolean;
  todayLaunches: number;
  maxDailyLaunches: number;
  masterWalletAddress: string;
  masterWalletBalance: number;
  subWalletCount: number;
  subWalletTotalBalance: number;
  activeTokens: ActiveTokenSummary[];
  todayPnl: {
    tokensLaunched: number;
    tokensHit: number;
    totalCostSol: number;
    totalRevenueSol: number;
    netPnlSol: number;
    hitRate: number;
  } | null;
}

export interface ActiveTokenSummary {
  id: number;
  name: string;
  ticker: string;
  mintAddress: string;
  status: string;
  bondingProgress: number;
  initialBuySol: number | null;
  launchedAt: Date | null;
}

export function dashboardView(data: DashboardData): string {
  const pnl = data.todayPnl;
  const netPnl = pnl?.netPnlSol ?? 0;
  const pnlColor = netPnl >= 0 ? "text-green-400" : "text-red-400";
  const pnlSign = netPnl >= 0 ? "+" : "";

  return `
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-6"
       hx-get="/api/dashboard" hx-trigger="every 10s" hx-swap="innerHTML" hx-target="#dashboard-content">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">Dashboard</h1>
      <div class="flex items-center gap-3">
        ${data.dryRun ? '<span class="text-xs px-2 py-1 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-800">DRY RUN</span>' : '<span class="text-xs px-2 py-1 rounded bg-green-900/50 text-green-400 border border-green-800">LIVE</span>'}
        <span class="text-xs text-gray-600">Auto-refresh: 10s</span>
      </div>
    </div>

    <div id="dashboard-content">
      ${dashboardContent(data)}
    </div>
  </div>`;
}

export function dashboardContent(data: DashboardData): string {
  const pnl = data.todayPnl;
  const netPnl = pnl?.netPnlSol ?? 0;
  const pnlColor = netPnl >= 0 ? "text-green-400" : "text-red-400";
  const pnlSign = netPnl >= 0 ? "+" : "";

  return `
    <!-- Stats Row -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      ${card(
        "Master Wallet",
        `${stat(truncAddr(data.masterWalletAddress), `${data.masterWalletBalance.toFixed(4)} SOL`)}`
      )}
      ${card(
        "Sub Wallets",
        `${stat(`${data.subWalletCount} wallets`, `${data.subWalletTotalBalance.toFixed(4)} SOL`)}`
      )}
      ${card(
        "Today Launches",
        `${stat(`limit: ${data.maxDailyLaunches}`, `${data.todayLaunches} / ${data.maxDailyLaunches}`)}`
      )}
      ${card(
        "Today P&L",
        `<p class="text-2xl font-bold ${pnlColor}">${pnlSign}${netPnl.toFixed(4)} SOL</p>
         <p class="text-xs text-gray-500 mt-1">Hit rate: ${((pnl?.hitRate ?? 0) * 100).toFixed(0)}%</p>`
      )}
    </div>

    <!-- P&L Details -->
    ${
      pnl
        ? card(
            "Today Details",
            `<div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              ${miniStat("Launched", String(pnl.tokensLaunched))}
              ${miniStat("Hit (50%+)", String(pnl.tokensHit))}
              ${miniStat("Cost", `${pnl.totalCostSol.toFixed(4)} SOL`)}
              ${miniStat("Revenue", `${pnl.totalRevenueSol.toFixed(4)} SOL`)}
              ${miniStat("Net", `${pnlSign}${netPnl.toFixed(4)} SOL`, netPnl >= 0 ? "text-green-400" : "text-red-400")}
            </div>`
          )
        : ""
    }

    <!-- Active Tokens -->
    ${card(
      `Active Tokens (${data.activeTokens.length})`,
      data.activeTokens.length === 0
        ? '<p class="text-gray-600 text-sm">No active tokens</p>'
        : `<div class="space-y-3">
            ${data.activeTokens.map((t) => tokenRow(t)).join("")}
          </div>`
    )}`;
}

function tokenRow(t: ActiveTokenSummary): string {
  const age = t.launchedAt ? timeSince(t.launchedAt) : "—";
  return `
  <a href="/tokens/${t.id}" class="flex items-center justify-between p-3 rounded bg-gray-800/50 hover:bg-gray-800 transition-colors">
    <div class="flex items-center gap-3">
      <div>
        <span class="font-medium">${t.name}</span>
        <span class="text-gray-500 text-sm ml-1">$${t.ticker}</span>
      </div>
      ${statusBadge(t.status)}
    </div>
    <div class="flex items-center gap-4">
      <div class="w-32">
        ${progressBar(t.bondingProgress)}
        <p class="text-xs text-gray-500 mt-1">${t.bondingProgress.toFixed(1)}%</p>
      </div>
      <div class="text-right text-sm">
        <p class="text-gray-400">${t.initialBuySol?.toFixed(3) ?? "—"} SOL</p>
        <p class="text-xs text-gray-600">${age}</p>
      </div>
    </div>
  </a>`;
}

function miniStat(label: string, value: string, color = "text-gray-100"): string {
  return `
  <div>
    <p class="text-gray-500">${label}</p>
    <p class="font-medium ${color}">${value}</p>
  </div>`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
