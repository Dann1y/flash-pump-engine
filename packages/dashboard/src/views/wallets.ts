import { card, stat } from "./layout";

export interface WalletItem {
  id: number;
  address: string;
  derivationPath: string | null;
  solBalance: number;
  isActive: boolean;
  lastUsedAt: Date | null;
  liveBalance: number | null;
}

export interface WalletFlowItem {
  tokenName: string;
  tokenTicker: string;
  type: string;
  solAmount: number;
  wallet: string;
  txSignature: string | null;
  executedAt: Date | null;
}

export function walletsView(
  masterWallet: { address: string; balance: number },
  subWallets: WalletItem[],
): string {
  const totalSubBalance = subWallets.reduce(
    (sum, w) => sum + (w.liveBalance ?? w.solBalance),
    0,
  );
  const activeCount = subWallets.filter((w) => w.isActive).length;

  return `
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-6"
       hx-get="/wallets/partial" hx-trigger="every 15s" hx-swap="innerHTML" hx-target="#wallets-content">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">Wallets</h1>
      <div class="flex gap-2">
        <a href="/wallets/flow" class="text-sm text-gray-400 hover:text-gray-200 px-3 py-1 rounded bg-gray-800">Fund Flow</a>
      </div>
    </div>

    <div id="wallets-content">
      ${walletsContent(masterWallet, subWallets)}
    </div>
  </div>`;
}

export function walletsContent(
  masterWallet: { address: string; balance: number },
  subWallets: WalletItem[],
): string {
  const totalSubBalance = subWallets.reduce(
    (sum, w) => sum + (w.liveBalance ?? w.solBalance),
    0,
  );
  const activeCount = subWallets.filter((w) => w.isActive).length;

  return `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      ${card(
        "Master Wallet",
        `<p class="font-mono text-xs text-gray-500 mb-2">${masterWallet.address}</p>
         <p class="text-2xl font-bold">${masterWallet.balance.toFixed(4)} SOL</p>`
      )}
      ${card("Sub Wallets", stat(`${activeCount} active`, `${totalSubBalance.toFixed(4)} SOL`))}
      ${card(
        "Total",
        `<p class="text-2xl font-bold text-pump-400">${(masterWallet.balance + totalSubBalance).toFixed(4)} SOL</p>`
      )}
    </div>

    ${card(
      "Sub Wallet Pool",
      subWallets.length === 0
        ? '<p class="text-gray-600 text-sm">No sub wallets</p>'
        : `<table class="w-full text-sm">
          <thead>
            <tr class="text-gray-500 text-left border-b border-gray-800">
              <th class="pb-2 font-medium">#</th>
              <th class="pb-2 font-medium">Address</th>
              <th class="pb-2 font-medium">Balance</th>
              <th class="pb-2 font-medium">Status</th>
              <th class="pb-2 font-medium">Last Used</th>
            </tr>
          </thead>
          <tbody>
            ${subWallets.map((w, i) => walletRow(w, i)).join("")}
          </tbody>
        </table>`
    )}`;
}

function walletRow(w: WalletItem, index: number): string {
  const balance = w.liveBalance ?? w.solBalance;
  const lastUsed = w.lastUsedAt
    ? w.lastUsedAt.toISOString().replace("T", " ").slice(0, 16)
    : "—";
  const statusClass = w.isActive
    ? "text-green-400"
    : "text-gray-600";

  return `
  <tr class="border-b border-gray-800/30">
    <td class="py-2 text-gray-600">${index + 1}</td>
    <td class="py-2 font-mono text-xs text-gray-400">${w.address}</td>
    <td class="py-2 ${balance < 0.01 ? "text-red-400" : "text-gray-300"}">${balance.toFixed(4)} SOL</td>
    <td class="py-2 ${statusClass}">${w.isActive ? "Active" : "Inactive"}</td>
    <td class="py-2 text-gray-600 text-xs">${lastUsed}</td>
  </tr>`;
}

export function walletFlowView(flows: WalletFlowItem[]): string {
  return `
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-6">
    <div class="flex items-center gap-3">
      <a href="/wallets" class="text-gray-500 hover:text-gray-300">&larr;</a>
      <h1 class="text-xl font-bold">Fund Flow</h1>
    </div>

    ${card(
      `Recent Trades (${flows.length})`,
      flows.length === 0
        ? '<p class="text-gray-600 text-sm">No trades yet</p>'
        : `<table class="w-full text-sm">
          <thead>
            <tr class="text-gray-500 text-left border-b border-gray-800">
              <th class="pb-2 font-medium">Token</th>
              <th class="pb-2 font-medium">Type</th>
              <th class="pb-2 font-medium">Amount</th>
              <th class="pb-2 font-medium">Wallet</th>
              <th class="pb-2 font-medium">Tx</th>
              <th class="pb-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            ${flows.map((f) => flowRow(f)).join("")}
          </tbody>
        </table>`
    )}
  </div>`;
}

function flowRow(f: WalletFlowItem): string {
  const typeColor = f.type === "buy" ? "text-green-400" : "text-red-400";
  const txLink = f.txSignature
    ? `<a href="https://solscan.io/tx/${f.txSignature}" target="_blank" class="text-blue-400 hover:underline font-mono">${f.txSignature.slice(0, 8)}...</a>`
    : "—";
  const time = f.executedAt
    ? f.executedAt.toISOString().replace("T", " ").slice(0, 16)
    : "—";

  return `
  <tr class="border-b border-gray-800/30">
    <td class="py-2 text-gray-300">${f.tokenName} <span class="text-gray-500">$${f.tokenTicker}</span></td>
    <td class="py-2 ${typeColor} font-medium">${f.type.toUpperCase()}</td>
    <td class="py-2 text-gray-300">${f.solAmount.toFixed(4)} SOL</td>
    <td class="py-2 font-mono text-xs text-gray-500">${truncAddr(f.wallet)}</td>
    <td class="py-2 text-xs">${txLink}</td>
    <td class="py-2 text-gray-600 text-xs">${time}</td>
  </tr>`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
