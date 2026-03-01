import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { eq, and } from "drizzle-orm";
import { createLogger, getDb, getRedis, tokens, trades } from "@flash-pump/shared";
import type { BondingCurveSnapshot } from "./monitor";
import { fetchAllSnapshots } from "./monitor";
import { isMigrationComplete } from "./raydium";
import { executeJupiterSell } from "./raydium";
import { executePumpSell } from "./seller";
import { calculateTokenPnl } from "./pnl";
import { REDIS_CHANNELS, EXIT_DEFAULTS } from "./constants";

const log = createLogger("exit-engine");

/** Exit configuration (loaded from env at startup) */
export interface ExitConfig {
  stage1Multiplier: number;
  stage1BondingPct: number;
  stage2BondingPct: number;
  trailingStopPct: number;
  emergencyLossPct: number;
}

/** In-memory representation of an active position */
export interface ActivePosition {
  tokenId: number;
  mintAddress: string;
  deployWallet: string;
  initialBuySol: number;
  initialBuyTokens: bigint;
  /** Tokens we still hold */
  remainingTokens: bigint;
  /** Entry price (SOL per token) from initial buy */
  entryPrice: number;
  /** Highest price seen — for trailing stop */
  peakPrice: number;
  /** Current exit stage: 0 = no exits yet, 1/2/3 = last completed stage */
  currentStage: number;
  /** Whether Raydium migration has occurred */
  raydiumMigrated: boolean;
  /** Lock to prevent concurrent sell attempts */
  selling: boolean;
}

/** What action the exit evaluator returns */
export interface ExitAction {
  stage: 1 | 2 | 3;
  sellTokens: bigint;
  reason: string;
  isEmergency: boolean;
}

// ─── Position Management ───────────────────────────────────────────────

/** In-memory active positions map */
const positions = new Map<number, ActivePosition>();

export function getPositions(): Map<number, ActivePosition> {
  return positions;
}

/** Load all active/exiting tokens from DB into memory on startup */
export async function loadActivePositions(): Promise<void> {
  const db = getDb();

  const activeTokens = await db
    .select()
    .from(tokens)
    .where(
      eq(tokens.status, "active"),
    );

  const exitingTokens = await db
    .select()
    .from(tokens)
    .where(
      eq(tokens.status, "exiting"),
    );

  const allTokens = [...activeTokens, ...exitingTokens];

  for (const token of allTokens) {
    // Sum up buy tokens and sell tokens to get remaining
    const buyTrades = await db
      .select()
      .from(trades)
      .where(and(eq(trades.tokenId, token.id), eq(trades.type, "buy")));

    const sellTrades = await db
      .select()
      .from(trades)
      .where(and(eq(trades.tokenId, token.id), eq(trades.type, "sell")));

    const totalBought = buyTrades.reduce((sum, t) => sum + (t.tokenAmount ?? BigInt(0)), BigInt(0));
    const totalSold = sellTrades.reduce((sum, t) => sum + (t.tokenAmount ?? BigInt(0)), BigInt(0));
    const remainingTokens = totalBought - totalSold;

    // Determine current stage from last exit trade
    const lastExitStage = sellTrades.reduce(
      (max, t) => Math.max(max, t.exitStage ?? 0),
      0,
    );

    // Entry price: total buy SOL / total buy tokens
    const totalBuySol = buyTrades.reduce((sum, t) => sum + (t.solAmount ?? 0), 0);
    const entryPrice = Number(totalBought) > 0 ? totalBuySol / Number(totalBought) : 0;

    positions.set(token.id, {
      tokenId: token.id,
      mintAddress: token.mintAddress,
      deployWallet: token.deployWallet,
      initialBuySol: token.initialBuySol ?? 0,
      initialBuyTokens: totalBought,
      remainingTokens,
      entryPrice,
      peakPrice: entryPrice, // Will be updated on first tick
      currentStage: lastExitStage,
      raydiumMigrated: token.raydiumMigrated ?? false,
      selling: false,
    });
  }

  log.info({ count: positions.size }, "Loaded active positions from DB");
}

/** Add a new position from a Redis "token:launched" event */
export function addPosition(data: {
  tokenId: number;
  mintAddress: string;
  wallet: string;
  initialBuySol: number;
}): void {
  if (positions.has(data.tokenId)) {
    log.warn({ tokenId: data.tokenId }, "Position already tracked, skipping");
    return;
  }

  positions.set(data.tokenId, {
    tokenId: data.tokenId,
    mintAddress: data.mintAddress,
    deployWallet: data.wallet,
    initialBuySol: data.initialBuySol,
    initialBuyTokens: BigInt(0), // Updated on first tick after on-chain confirmation
    remainingTokens: BigInt(0),
    entryPrice: 0,
    peakPrice: 0,
    currentStage: 0,
    raydiumMigrated: false,
    selling: false,
  });

  log.info({ tokenId: data.tokenId, mintAddress: data.mintAddress }, "New position added");
}

// ─── Exit Condition Evaluator (Pure Function) ──────────────────────────

/**
 * Evaluate whether an exit should be triggered for a position.
 * Returns null if no exit condition is met.
 *
 * Priority order:
 *  1. Emergency exit (price -50% from entry or bonding curve vanished)
 *  2. Stage 3: post-Raydium + trailing stop
 *  3. Stage 2: bonding >= 70%
 *  4. Stage 1: value >= initial × multiplier OR bonding >= 40%
 */
export function evaluateExitCondition(
  pos: ActivePosition,
  snapshot: BondingCurveSnapshot | null,
  config: ExitConfig,
): ExitAction | null {
  // Skip if already selling or no tokens left
  if (pos.selling || pos.remainingTokens <= BigInt(0)) return null;

  // If bonding curve account is gone, emergency exit
  if (!snapshot) {
    return {
      stage: 1,
      sellTokens: pos.remainingTokens,
      reason: "Bonding curve account not found — emergency sell all",
      isEmergency: true,
    };
  }

  const { bondingProgress, pricePerToken } = snapshot;

  // ── Emergency Exit ──
  if (pos.entryPrice > 0 && pricePerToken > 0) {
    const priceDropPct = ((pos.entryPrice - pricePerToken) / pos.entryPrice) * 100;
    if (priceDropPct >= config.emergencyLossPct) {
      return {
        stage: 1,
        sellTokens: pos.remainingTokens,
        reason: `Emergency: price dropped ${priceDropPct.toFixed(1)}% from entry`,
        isEmergency: true,
      };
    }
  }

  // ── Stage 3: Post-Raydium trailing stop ──
  if (pos.currentStage >= 2 && pos.raydiumMigrated) {
    if (pos.peakPrice > 0 && pricePerToken > 0) {
      const dropFromPeak = ((pos.peakPrice - pricePerToken) / pos.peakPrice) * 100;
      if (dropFromPeak >= config.trailingStopPct) {
        return {
          stage: 3,
          sellTokens: pos.remainingTokens,
          reason: `Stage 3: trailing stop triggered (${dropFromPeak.toFixed(1)}% from peak)`,
          isEmergency: false,
        };
      }
    }
  }

  // ── Stage 2: bonding >= 70% ──
  if (pos.currentStage < 2 && bondingProgress >= config.stage2BondingPct) {
    // Sell 50% of remaining
    const sellTokens = pos.remainingTokens / BigInt(2);
    if (sellTokens > BigInt(0)) {
      return {
        stage: 2,
        sellTokens,
        reason: `Stage 2: bonding at ${bondingProgress.toFixed(1)}% (threshold: ${config.stage2BondingPct}%)`,
        isEmergency: false,
      };
    }
  }

  // ── Stage 1: value >= initial × multiplier OR bonding >= 40% ──
  if (pos.currentStage < 1) {
    const currentValue = Number(pos.remainingTokens) * pricePerToken;
    const valueMultiple = pos.initialBuySol > 0 ? currentValue / pos.initialBuySol : 0;
    const valueTriggered = valueMultiple >= config.stage1Multiplier;
    const bondingTriggered = bondingProgress >= config.stage1BondingPct;

    if (valueTriggered || bondingTriggered) {
      // Sell enough to recover initial SOL
      const tokensToRecover = pricePerToken > 0
        ? BigInt(Math.ceil(pos.initialBuySol / pricePerToken))
        : pos.remainingTokens;
      // Cap at remaining tokens
      const sellTokens = tokensToRecover > pos.remainingTokens
        ? pos.remainingTokens
        : tokensToRecover;

      if (sellTokens > BigInt(0)) {
        const trigger = valueTriggered
          ? `value ${valueMultiple.toFixed(1)}x initial`
          : `bonding at ${bondingProgress.toFixed(1)}%`;
        return {
          stage: 1,
          sellTokens,
          reason: `Stage 1: ${trigger}`,
          isEmergency: false,
        };
      }
    }
  }

  return null;
}

// ─── Monitor Tick Orchestrator ─────────────────────────────────────────

/**
 * Single tick of the monitoring loop:
 *  1. Batch-fetch bonding curve snapshots
 *  2. Update peak prices + migration flags
 *  3. Evaluate exit conditions
 *  4. Execute sells
 *  5. Update DB + publish Redis events
 */
export async function runMonitorTick(
  connection: Connection,
  config: ExitConfig,
): Promise<void> {
  if (positions.size === 0) return;

  const db = getDb();
  const redis = getRedis();

  // 1. Collect mint addresses for active (non-selling) positions
  const mintAddresses: string[] = [];
  const posArray: ActivePosition[] = [];
  for (const pos of positions.values()) {
    if (pos.remainingTokens > BigInt(0) && !pos.selling) {
      mintAddresses.push(pos.mintAddress);
      posArray.push(pos);
    }
  }

  if (mintAddresses.length === 0) return;

  // 2. Batch fetch
  const snapshots = await fetchAllSnapshots(connection, mintAddresses);

  // 3. Process each position
  for (const pos of posArray) {
    const snapshot = snapshots.get(pos.mintAddress) ?? null;

    // Update peak price tracking
    if (snapshot && snapshot.pricePerToken > pos.peakPrice) {
      pos.peakPrice = snapshot.pricePerToken;
    }

    // Update migration flag from bonding curve state
    if (snapshot && !pos.raydiumMigrated && isMigrationComplete(snapshot.state)) {
      pos.raydiumMigrated = true;
      await db
        .update(tokens)
        .set({ raydiumMigrated: true })
        .where(eq(tokens.id, pos.tokenId));

      log.info({ tokenId: pos.tokenId, mintAddress: pos.mintAddress }, "Raydium migration detected");

      await redis.publish(
        REDIS_CHANNELS.TOKEN_EXIT,
        JSON.stringify({
          type: "raydium_migration",
          tokenId: pos.tokenId,
          mintAddress: pos.mintAddress,
        }),
      );
    }

    // Update bonding progress in DB
    if (snapshot) {
      await db
        .update(tokens)
        .set({ bondingProgress: snapshot.bondingProgress })
        .where(eq(tokens.id, pos.tokenId));
    }

    // Update entry price / remaining tokens if not yet set (first tick after launch)
    if (pos.entryPrice === 0 && snapshot) {
      pos.entryPrice = snapshot.pricePerToken;
      pos.peakPrice = snapshot.pricePerToken;

      // Also try to get on-chain token balance for remaining tokens
      // (initial buy tokens may not have been recorded yet)
      if (pos.remainingTokens === BigInt(0)) {
        const tokenBalanceTrades = await db
          .select()
          .from(trades)
          .where(and(eq(trades.tokenId, pos.tokenId), eq(trades.type, "buy")));
        const totalBought = tokenBalanceTrades.reduce(
          (sum, t) => sum + (t.tokenAmount ?? BigInt(0)),
          BigInt(0),
        );
        if (totalBought > BigInt(0)) {
          pos.remainingTokens = totalBought;
          pos.initialBuyTokens = totalBought;
        }
      }
    }

    // 4. Evaluate exit condition
    const action = evaluateExitCondition(pos, snapshot, config);
    if (!action) continue;

    // Lock position to prevent concurrent sells
    pos.selling = true;

    try {
      log.info(
        {
          tokenId: pos.tokenId,
          stage: action.stage,
          sellTokens: action.sellTokens.toString(),
          reason: action.reason,
          isEmergency: action.isEmergency,
        },
        "Executing exit",
      );

      // Update token status
      await db
        .update(tokens)
        .set({ status: "exiting" })
        .where(eq(tokens.id, pos.tokenId));

      // 5. Execute sell (pump or jupiter depending on migration)
      let txSignature: string;
      let solReceived: number;

      if (pos.raydiumMigrated) {
        const result = await executeJupiterSell(
          pos.mintAddress,
          pos.deployWallet,
          action.sellTokens,
          connection,
        );
        txSignature = result.txSignature;
        solReceived = result.solReceived;
      } else {
        const result = await executePumpSell(
          pos.mintAddress,
          pos.deployWallet,
          action.sellTokens,
          connection,
        );
        txSignature = result.txSignature;

        // Estimate SOL received from price × tokens
        solReceived = snapshot
          ? Number(action.sellTokens) * snapshot.pricePerToken / LAMPORTS_PER_SOL
          : 0;
      }

      // 6. Record trade in DB
      await db.insert(trades).values({
        tokenId: pos.tokenId,
        type: "sell",
        solAmount: solReceived,
        tokenAmount: action.sellTokens,
        pricePerToken: snapshot?.pricePerToken ?? 0,
        wallet: pos.deployWallet,
        txSignature,
        exitStage: action.stage,
      });

      // 7. Update in-memory state
      pos.remainingTokens -= action.sellTokens;
      pos.currentStage = action.stage;

      // If no tokens left, mark as completed
      if (pos.remainingTokens <= BigInt(0)) {
        await db
          .update(tokens)
          .set({ status: "completed" })
          .where(eq(tokens.id, pos.tokenId));

        const pnl = await calculateTokenPnl(pos.tokenId);

        await redis.publish(
          REDIS_CHANNELS.TOKEN_COMPLETED,
          JSON.stringify({
            tokenId: pos.tokenId,
            mintAddress: pos.mintAddress,
            netPnlSol: pnl.netPnlSol,
          }),
        );

        positions.delete(pos.tokenId);

        log.info(
          { tokenId: pos.tokenId, netPnlSol: pnl.netPnlSol },
          "Position fully closed",
        );
      } else {
        // Still has tokens — reset status to active for continued monitoring
        await db
          .update(tokens)
          .set({ status: "active" })
          .where(eq(tokens.id, pos.tokenId));
      }

      // 8. Publish exit event for telegram-bot
      const channel = action.isEmergency
        ? REDIS_CHANNELS.TOKEN_EMERGENCY
        : REDIS_CHANNELS.TOKEN_EXIT;

      await redis.publish(
        channel,
        JSON.stringify({
          type: "exit_executed",
          tokenId: pos.tokenId,
          mintAddress: pos.mintAddress,
          stage: action.stage,
          solReceived,
          tokensRemaining: pos.remainingTokens.toString(),
          reason: action.reason,
        }),
      );
    } catch (err) {
      log.error(
        { tokenId: pos.tokenId, stage: action.stage, err },
        "Exit execution failed",
      );

      // Revert token status to active so we retry next tick
      await db
        .update(tokens)
        .set({ status: "active" })
        .where(eq(tokens.id, pos.tokenId));
    } finally {
      pos.selling = false;
    }
  }
}
