import { PublicKey } from "@solana/web3.js";

/** BullMQ queue name for launch signals */
export const QUEUE_NAME = "token-launch-queue";

/** PumpPortal REST API */
export const PUMP_PORTAL_URL = "https://pumpportal.fun/api/trade-local";

/** Jito Block Engine endpoints (4 regional) */
export const JITO_ENDPOINTS = [
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
] as const;

/** Jito tip accounts — pick one randomly per bundle */
export const JITO_TIP_ACCOUNTS = [
  new PublicKey("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"),
  new PublicKey("HFqU5x63VTqvQss8hp11i4bPuAiMvT8dk3AYvkdu2p7k"),
  new PublicKey("Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY"),
  new PublicKey("ADaUMid9yfUytqMBgopwjb2DTLSLCiLSBoE3e3oV8eFU"),
  new PublicKey("DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh"),
  new PublicKey("ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt"),
  new PublicKey("DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL"),
  new PublicKey("3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"),
] as const;

/** Anti-detection bounds */
export const ANTI_DETECTION = {
  /** Initial buy SOL range */
  minBuySol: 0.05,
  maxBuySol: 0.2,
  /** Jito tip SOL range */
  minTipSol: 0.001,
  maxTipSol: 0.005,
  /** Min seconds between launches (BullMQ rate limiter) */
  minLaunchIntervalSec: 180,
  /** Wallet cooldown in minutes */
  walletCooldownMin: 60,
} as const;

/** HD Wallet derivation base path (BIP-44 for Solana) */
export const HD_DERIVATION_BASE = "m/44'/501'";

/** pump.fun IPFS upload endpoint */
export const PUMP_IPFS_URL = "https://pump.fun/api/ipfs";
