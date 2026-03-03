import { Keypair } from "@solana/web3.js";
import { createLogger, getEnv } from "@flash-pump/shared";
import { PUMP_PORTAL_URL, ANTI_DETECTION } from "./constants";

const log = createLogger("deployer");

export interface DeployRequest {
  /** Wallet paying for creation + initial buy */
  deployerAddress: string;
  /** Token name */
  name: string;
  /** Token ticker/symbol */
  ticker: string;
  /** Token description */
  description: string;
  /** IPFS metadata URI from pump.fun upload */
  metadataUri: string;
  /** Initial buy amount in SOL (randomized) */
  initialBuySol: number;
}

export interface DeployResult {
  /** Fresh mint keypair for this token */
  mintKeypair: Keypair;
  /** bs58-encoded unsigned transactions [createTx, buyTx] from PumpPortal bundle API */
  txsBase58: string[];
}

/** Randomize initial buy amount within anti-detection bounds */
export function randomizeBuyAmount(): number {
  const { minBuySol, maxBuySol } = ANTI_DETECTION;
  return minBuySol + Math.random() * (maxBuySol - minBuySol);
}

/**
 * Call PumpPortal bundle API to build create + buy VersionedTransactions.
 *
 * PumpPortal's create action has a bug with dev buy amount > 0 (Token2022 migration),
 * so we split into [create(amount=0), buy(amount)] as a bundle array.
 * The response is a JSON array of bs58-encoded unsigned transactions.
 */
export async function buildDeployTransaction(req: DeployRequest, existingMint?: Keypair): Promise<DeployResult> {
  const mintKeypair = existingMint ?? Keypair.generate();

  if (getEnv().DRY_RUN) {
    log.info(
      { name: req.name, ticker: req.ticker, mint: mintKeypair.publicKey.toBase58() },
      "[DRY_RUN] Skipping PumpPortal create API, returning empty txs",
    );
    return { mintKeypair, txsBase58: [] };
  }

  // No internal retry — caller handles retry with fresh blockhash
  {
      log.info(
        {
          name: req.name,
          ticker: req.ticker,
          mint: mintKeypair.publicKey.toBase58(),
          buySol: req.initialBuySol,
        },
        "Building deploy transactions via PumpPortal bundle API",
      );

      // Bundle: create(0) + buy(amount) as array
      // PumpPortal bug: create with amount>0 fails (Token2022 toBuffer error)
      const tipSol = ANTI_DETECTION.minTipSol + Math.random() * (ANTI_DETECTION.maxTipSol - ANTI_DETECTION.minTipSol);

      const bundledTxArgs = [
        {
          publicKey: req.deployerAddress,
          action: "create",
          tokenMetadata: {
            name: req.name,
            symbol: req.ticker,
            uri: req.metadataUri,
          },
          mint: mintKeypair.publicKey.toBase58(),
          denominatedInSol: "true",
          amount: 0,
          slippage: 10,
          priorityFee: tipSol, // First tx priorityFee = Jito tip
          pool: "pump",
        },
        {
          publicKey: req.deployerAddress,
          action: "buy",
          mint: mintKeypair.publicKey.toBase58(),
          denominatedInSol: "true",
          amount: req.initialBuySol,
          slippage: 50,
          priorityFee: 0.00005, // Ignored in bundle (only first matters)
          pool: "pump",
        },
      ];

      const res = await fetch(PUMP_PORTAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundledTxArgs),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`PumpPortal API error (${res.status}): ${errBody}`);
      }

      const txsBase58: string[] = await res.json();

      if (!Array.isArray(txsBase58) || txsBase58.length < 2) {
        throw new Error(`Expected 2 transactions, got ${txsBase58?.length ?? 0}`);
      }

      log.info(
        {
          mint: mintKeypair.publicKey.toBase58(),
          txCount: txsBase58.length,
          tipSol: tipSol.toFixed(5),
        },
        "Deploy transactions built",
      );

      return { mintKeypair, txsBase58 };
  }
}
