import { Keypair } from "@solana/web3.js";
import { createLogger, getEnv } from "@flash-pump/shared";
import { PUMP_PORTAL_URL, ANTI_DETECTION } from "./constants";
import { withRetry } from "./retry";

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
  /** Base64-encoded unsigned VersionedTransaction for token creation */
  createTxBase64: string;
}

/** Randomize initial buy amount within anti-detection bounds */
export function randomizeBuyAmount(): number {
  const { minBuySol, maxBuySol } = ANTI_DETECTION;
  return minBuySol + Math.random() * (maxBuySol - minBuySol);
}

/**
 * Call PumpPortal API to build create + initial-buy VersionedTransaction.
 * Returns unsigned transaction bytes + mint keypair.
 */
export async function buildDeployTransaction(req: DeployRequest): Promise<DeployResult> {
  const mintKeypair = Keypair.generate();

  if (getEnv().DRY_RUN) {
    log.info(
      { name: req.name, ticker: req.ticker, mint: mintKeypair.publicKey.toBase58() },
      "[DRY_RUN] Skipping PumpPortal create API, returning empty tx",
    );
    return { mintKeypair, createTxBase64: "" };
  }

  return withRetry(
    async () => {
      log.info(
        {
          name: req.name,
          ticker: req.ticker,
          mint: mintKeypair.publicKey.toBase58(),
          buySol: req.initialBuySol,
        },
        "Building deploy transaction via PumpPortal",
      );

      const body = {
        publicKey: req.deployerAddress,
        action: "create",
        tokenMetadata: {
          name: req.name,
          symbol: req.ticker,
          uri: req.metadataUri,
        },
        mint: mintKeypair.publicKey.toBase58(),
        denominatedInSol: "true",
        amount: req.initialBuySol,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
      };

      const res = await fetch(PUMP_PORTAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`PumpPortal API error (${res.status}): ${errBody}`);
      }

      // PumpPortal returns raw transaction bytes
      const txBuffer = Buffer.from(await res.arrayBuffer());
      const createTxBase64 = txBuffer.toString("base64");

      log.info(
        { mint: mintKeypair.publicKey.toBase58(), txSize: txBuffer.length },
        "Deploy transaction built",
      );

      return { mintKeypair, createTxBase64 };
    },
    { maxAttempts: 3, label: "buildDeployTransaction" },
  );
}
