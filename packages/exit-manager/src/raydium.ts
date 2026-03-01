import {
  Keypair,
  Connection,
  VersionedTransaction,
} from "@solana/web3.js";
import { createLogger } from "@flash-pump/shared";
import {
  JUPITER_API_URL,
  SOL_MINT,
  SELL_SLIPPAGE_BPS,
  TX_CONFIRM_TIMEOUT_MS,
} from "./constants";
import { getKeypairForWallet } from "./seller";
import { withRetry } from "./retry";
import type { BondingCurveState } from "./monitor";

const log = createLogger("raydium");

/** Check if bonding curve is complete (Raydium migration triggered) */
export function isMigrationComplete(state: BondingCurveState): boolean {
  return state.complete;
}

export interface JupiterSellResult {
  txSignature: string;
  solReceived: number;
}

/**
 * Execute a sell through Jupiter aggregator (routes through Raydium AMM pool).
 * Used post-Raydium migration when pump.fun bonding curve is no longer active.
 *
 * Steps:
 *  1. GET Jupiter quote (token → SOL)
 *  2. POST Jupiter swap to get unsigned transaction
 *  3. Sign + submit + confirm
 */
export async function executeJupiterSell(
  mintAddress: string,
  walletAddress: string,
  tokenAmount: bigint,
  connection: Connection,
): Promise<JupiterSellResult> {
  const keypair = getKeypairForWallet(walletAddress);

  return withRetry(
    async () => {
      log.info(
        { mintAddress, wallet: walletAddress, tokenAmount: tokenAmount.toString() },
        "Executing Jupiter sell (post-Raydium)",
      );

      // 1. Get quote: sell token for SOL
      const quoteParams = new URLSearchParams({
        inputMint: mintAddress,
        outputMint: SOL_MINT,
        amount: tokenAmount.toString(),
        slippageBps: SELL_SLIPPAGE_BPS.toString(),
      });

      const quoteRes = await fetch(`${JUPITER_API_URL}/quote?${quoteParams}`);
      if (!quoteRes.ok) {
        const errBody = await quoteRes.text();
        throw new Error(`Jupiter quote API error (${quoteRes.status}): ${errBody}`);
      }

      const quoteData = (await quoteRes.json()) as {
        outAmount?: string;
        routePlan?: unknown[];
      };

      if (!quoteData.outAmount) {
        throw new Error("Jupiter returned no output amount — no liquidity?");
      }

      const estimatedSolLamports = Number(quoteData.outAmount);
      log.info(
        { estimatedSol: estimatedSolLamports / 1e9, routes: quoteData.routePlan?.length },
        "Jupiter quote received",
      );

      // 2. Get swap transaction
      const swapRes = await fetch(`${JUPITER_API_URL}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        }),
      });

      if (!swapRes.ok) {
        const errBody = await swapRes.text();
        throw new Error(`Jupiter swap API error (${swapRes.status}): ${errBody}`);
      }

      const swapData = (await swapRes.json()) as { swapTransaction?: string };
      const txBase64 = swapData.swapTransaction;

      if (!txBase64) {
        throw new Error("Jupiter returned no swap transaction");
      }

      // 3. Deserialize, sign, and submit
      const txBytes = Buffer.from(txBase64, "base64");
      const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
      tx.sign([keypair]);

      const txSignature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });

      log.info({ txSignature, mintAddress }, "Jupiter sell tx submitted");

      // 4. Confirm
      const confirmation = await connection.confirmTransaction(
        txSignature,
        "confirmed",
      );

      if (confirmation.value.err) {
        throw new Error(`Jupiter sell tx failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const solReceived = estimatedSolLamports / 1e9;

      log.info(
        { txSignature, mintAddress, solReceived, tokenAmount: tokenAmount.toString() },
        "Jupiter sell confirmed",
      );

      return { txSignature, solReceived };
    },
    { maxAttempts: 3, label: `jupiterSell(${mintAddress.slice(0, 8)})` },
  );
}
