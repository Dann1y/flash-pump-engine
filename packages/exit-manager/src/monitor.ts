import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { createLogger, getEnv } from "@flash-pump/shared";
import { PUMPFUN_PROGRAM_ID, BONDING_CURVE_TARGET_LAMPORTS } from "./constants";
import { withRetry } from "./retry";

/**
 * DRY_RUN simulation: tracks per-mint start time and simulates bonding curve
 * progressing from 0% → 100% over ~5 minutes.
 *
 * Timeline:
 *   0–2 min:   0% → 40%  (Stage 1 trigger at ~2min)
 *   2–3.5 min: 40% → 70% (Stage 2 trigger at ~3.5min)
 *   3.5–5 min: 70% → 100% + complete=true (Stage 3 / Raydium migration)
 */
const dryRunStartTimes = new Map<string, number>();
const DRY_RUN_DURATION_MS = 5 * 60 * 1000; // 5 minutes total

function getDryRunSnapshot(mintAddress: string): BondingCurveSnapshot {
  if (!dryRunStartTimes.has(mintAddress)) {
    dryRunStartTimes.set(mintAddress, Date.now());
  }

  const elapsed = Date.now() - dryRunStartTimes.get(mintAddress)!;
  const progress = Math.min((elapsed / DRY_RUN_DURATION_MS) * 100, 100);
  const complete = progress >= 100;

  // Simulate reserves proportional to progress
  const realSolLamports = BigInt(Math.round((progress / 100) * BONDING_CURVE_TARGET_LAMPORTS));
  const tokenSupply = BigInt("1000000000000000"); // 1B tokens (6 decimals)
  const soldTokens = BigInt(Math.round(Number(tokenSupply) * (progress / 100)));
  const remainingTokens = tokenSupply - soldTokens;

  const state: BondingCurveState = {
    virtualTokenReserves: remainingTokens + BigInt("800000000000000"),
    virtualSolReserves: BigInt("30000000000") + realSolLamports,
    realTokenReserves: remainingTokens,
    realSolReserves: realSolLamports,
    tokenTotalSupply: tokenSupply,
    complete,
  };

  const vSol = Number(state.virtualSolReserves);
  const vToken = Number(state.virtualTokenReserves);
  const pricePerToken = vToken > 0 ? vSol / vToken : 0;

  return { mintAddress, state, bondingProgress: progress, pricePerToken };
}

const log = createLogger("monitor");

/**
 * Raw bonding curve account data layout (after 8-byte discriminator):
 *   virtualTokenReserves: u64 (8 bytes) LE
 *   virtualSolReserves:   u64 (8 bytes) LE
 *   realTokenReserves:    u64 (8 bytes) LE
 *   realSolReserves:      u64 (8 bytes) LE
 *   tokenTotalSupply:     u64 (8 bytes) LE
 *   complete:             bool (1 byte)
 *
 * Total: 8 + 5*8 + 1 = 49 bytes
 */
export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  /** true when bonding curve is filled → Raydium migration triggered */
  complete: boolean;
}

/** Processed snapshot with derived metrics */
export interface BondingCurveSnapshot {
  mintAddress: string;
  state: BondingCurveState;
  /** 0–100 bonding curve fill percentage */
  bondingProgress: number;
  /** Price per token in SOL (virtual reserves ratio) */
  pricePerToken: number;
}

/** Minimum account data size for a valid bonding curve */
const MIN_ACCOUNT_SIZE = 49;

/** Derive the bonding curve PDA for a given token mint */
export function deriveBondingCurvePDA(mintAddress: string): PublicKey {
  const mint = new PublicKey(mintAddress);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID,
  );
  return pda;
}

/** Deserialize raw account data into BondingCurveState */
export function deserializeBondingCurve(data: Buffer): BondingCurveState {
  if (data.length < MIN_ACCOUNT_SIZE) {
    throw new Error(`Bonding curve data too short: ${data.length} bytes (need ${MIN_ACCOUNT_SIZE})`);
  }

  // Skip 8-byte discriminator
  const offset = 8;

  const virtualTokenReserves = data.readBigUInt64LE(offset);
  const virtualSolReserves = data.readBigUInt64LE(offset + 8);
  const realTokenReserves = data.readBigUInt64LE(offset + 16);
  const realSolReserves = data.readBigUInt64LE(offset + 24);
  const tokenTotalSupply = data.readBigUInt64LE(offset + 32);
  const complete = data[offset + 40] === 1;

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
  };
}

/** Calculate derived metrics from raw bonding curve state */
function computeSnapshot(mintAddress: string, state: BondingCurveState): BondingCurveSnapshot {
  // Progress = realSolReserves / target (as percentage)
  const realSolLamports = Number(state.realSolReserves);
  const bondingProgress = Math.min(
    (realSolLamports / BONDING_CURVE_TARGET_LAMPORTS) * 100,
    100,
  );

  // Price = virtualSolReserves / virtualTokenReserves (in SOL per token)
  const vSol = Number(state.virtualSolReserves);
  const vToken = Number(state.virtualTokenReserves);
  const pricePerToken = vToken > 0 ? vSol / vToken : 0;

  return { mintAddress, state, bondingProgress, pricePerToken };
}

/** Fetch bonding curve state for a single token */
export async function fetchBondingCurveState(
  connection: Connection,
  mintAddress: string,
): Promise<BondingCurveSnapshot | null> {
  if (getEnv().DRY_RUN) {
    const snapshot = getDryRunSnapshot(mintAddress);
    log.debug(
      { mintAddress, progress: snapshot.bondingProgress.toFixed(1), complete: snapshot.state.complete },
      "[DRY_RUN] Simulated bonding curve state",
    );
    return snapshot;
  }

  const pda = deriveBondingCurvePDA(mintAddress);

  const accountInfo = await withRetry(
    () => connection.getAccountInfo(pda),
    { maxAttempts: 3, label: `fetchBondingCurve(${mintAddress.slice(0, 8)})` },
  );

  if (!accountInfo?.data) {
    log.warn({ mintAddress }, "Bonding curve account not found");
    return null;
  }

  const state = deserializeBondingCurve(Buffer.from(accountInfo.data));
  return computeSnapshot(mintAddress, state);
}

/**
 * Batch-fetch bonding curve states for multiple tokens in a single RPC call.
 * Uses getMultipleAccountsInfo for efficiency (1 RPC call instead of N).
 */
export async function fetchAllSnapshots(
  connection: Connection,
  mintAddresses: string[],
): Promise<Map<string, BondingCurveSnapshot>> {
  if (mintAddresses.length === 0) return new Map();

  if (getEnv().DRY_RUN) {
    const results = new Map<string, BondingCurveSnapshot>();
    for (const mint of mintAddresses) {
      results.set(mint, getDryRunSnapshot(mint));
    }
    log.debug({ count: results.size }, "[DRY_RUN] Simulated batch bonding curve snapshots");
    return results;
  }

  const pdas = mintAddresses.map((mint) => deriveBondingCurvePDA(mint));

  const accounts = await withRetry(
    () => connection.getMultipleAccountsInfo(pdas),
    { maxAttempts: 3, label: "fetchAllSnapshots" },
  );

  const results = new Map<string, BondingCurveSnapshot>();

  for (let i = 0; i < mintAddresses.length; i++) {
    const mintAddress = mintAddresses[i];
    const accountInfo: AccountInfo<Buffer> | null = accounts[i];

    if (!accountInfo?.data) {
      log.warn({ mintAddress }, "Bonding curve account missing in batch");
      continue;
    }

    try {
      const state = deserializeBondingCurve(Buffer.from(accountInfo.data));
      results.set(mintAddress, computeSnapshot(mintAddress, state));
    } catch (err) {
      log.error({ mintAddress, err }, "Failed to deserialize bonding curve");
    }
  }

  log.debug({ requested: mintAddresses.length, received: results.size }, "Batch fetch complete");
  return results;
}
