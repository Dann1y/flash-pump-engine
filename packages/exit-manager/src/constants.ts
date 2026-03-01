import { PublicKey } from "@solana/web3.js";

/** PumpPortal REST API (same endpoint for sell as token-launcher uses for create) */
export const PUMP_PORTAL_URL = "https://pumpportal.fun/api/trade-local";

/** Jupiter aggregator API base URL */
export const JUPITER_API_URL = "https://quote-api.jup.ag/v6";

/** pump.fun program ID */
export const PUMPFUN_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

/** Raydium AMM program ID */
export const RAYDIUM_AMM_PROGRAM_ID = new PublicKey(
  "675kPX9MHTjS2zt1qrXjVVn2F2wDwmwQjwBajiRBUWZ",
);

/** Native SOL mint address (for Jupiter swaps) */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** pump.fun bonding curve target in lamports (~85 SOL fills the curve) */
export const BONDING_CURVE_TARGET_LAMPORTS = 85_000_000_000;

/** HD Wallet derivation base path (BIP-44 for Solana) — must match token-launcher */
export const HD_DERIVATION_BASE = "m/44'/501'";

/** Redis pub/sub channels */
export const REDIS_CHANNELS = {
  /** Incoming: new token launched by token-launcher */
  TOKEN_LAUNCHED: "token:launched",
  /** Outgoing: exit stage executed */
  TOKEN_EXIT: "token:exit",
  /** Outgoing: all positions closed for a token */
  TOKEN_COMPLETED: "token:completed",
  /** Outgoing: emergency exit triggered */
  TOKEN_EMERGENCY: "token:emergency",
} as const;

/** Monitor loop interval (ms) */
export const MONITOR_INTERVAL_MS = 5_000;

/** Daily P&L aggregation interval (ms) — every 5 minutes */
export const PNL_INTERVAL_MS = 5 * 60 * 1_000;

/** Sell slippage for meme coins (15% — high volatility) */
export const SELL_SLIPPAGE_BPS = 1500;

/** Transaction confirmation timeout (ms) */
export const TX_CONFIRM_TIMEOUT_MS = 30_000;

/** Exit stage defaults (overridden by env if set) */
export const EXIT_DEFAULTS = {
  /** Stage 1: sell enough to recover initial SOL when value >= initial × multiplier */
  stage1Multiplier: 3,
  /** Stage 1: also triggers at this bonding % */
  stage1BondingPct: 40,
  /** Stage 2: sell 50% of remaining at this bonding % */
  stage2BondingPct: 70,
  /** Stage 3: trailing stop — sell all when price drops this % from peak */
  trailingStopPct: 30,
  /** Emergency: sell all when price drops this % from entry */
  emergencyLossPct: 50,
  /** Emergency: sell all after this many hours of zero volume */
  emergencyStaleHours: 12,
} as const;
