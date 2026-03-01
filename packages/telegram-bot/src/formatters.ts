import { PUMP_FUN_URL } from "./constants";

/** Format SOL amount with 4 decimal places */
export function fmtSol(sol: number): string {
  return `${sol.toFixed(4)} SOL`;
}

/** Format percentage */
export function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** Format P&L with +/- sign */
export function fmtPnl(sol: number): string {
  const sign = sol >= 0 ? "+" : "";
  return `${sign}${sol.toFixed(4)} SOL`;
}

/** pump.fun token link */
export function pumpLink(mintAddress: string): string {
  return `${PUMP_FUN_URL}/${mintAddress}`;
}

/** Solscan transaction link */
export function txLink(txSignature: string): string {
  return `https://solscan.io/tx/${txSignature}`;
}

/** Escape Telegram MarkdownV2 special characters */
export function escMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/** Status emoji mapping */
export function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    deploying: "🔄",
    active: "🟢",
    exiting: "🟡",
    completed: "✅",
    failed: "❌",
  };
  return map[status] ?? "❓";
}
