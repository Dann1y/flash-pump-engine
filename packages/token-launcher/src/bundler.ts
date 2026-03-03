import {
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { createLogger, getEnv } from "@flash-pump/shared";
import { JITO_ENDPOINTS } from "./constants";

const log = createLogger("bundler");

/** Submit bundle to a specific Jito endpoint */
async function submitToEndpoint(
  endpoint: string,
  serializedTxs: string[],
): Promise<string> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [serializedTxs],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Jito ${endpoint} error (${res.status}): ${errBody}`);
  }

  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) {
    throw new Error(`Jito RPC error: ${json.error.message}`);
  }

  if (!json.result) {
    throw new Error("Jito returned no bundle ID");
  }

  return json.result;
}

/** Poll Jito for bundle status confirmation */
async function pollBundleStatus(
  endpoint: string,
  bundleId: string,
  timeoutMs: number = 30000,
): Promise<"Landed" | "Failed"> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getBundleStatuses",
      params: [[bundleId]],
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        result?: { value: Array<{ bundle_id: string; confirmation_status: string }> };
      };

      const status = json.result?.value?.[0];
      if (status) {
        if (status.confirmation_status === "confirmed" || status.confirmation_status === "finalized") {
          return "Landed";
        }
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return "Failed";
}

export interface BundleRequest {
  /** bs58-encoded unsigned transactions from PumpPortal bundle API [createTx, buyTx] */
  txsBase58: string[];
  /** Mint keypair (must sign the create tx) */
  mintKeypair: Keypair;
  /** Deployer wallet keypair (signs both txs) */
  deployerKeypair: Keypair;
}

export interface BundleResult {
  bundleId: string;
  status: "Landed" | "Failed";
}

/**
 * Sign PumpPortal bundle transactions and submit via Jito.
 *
 * The PumpPortal bundle API returns [createTx, buyTx] as bs58-encoded unsigned txs.
 * - createTx needs both mintKeypair + deployerKeypair signatures
 * - buyTx needs only deployerKeypair signature
 * - First tx's priorityFee is the Jito tip (no separate tip tx needed)
 */
export async function submitBundle(req: BundleRequest): Promise<BundleResult> {
  const env = getEnv();

  if (env.DRY_RUN) {
    const bundleId = `dry-run-${Date.now()}-${req.mintKeypair.publicKey.toBase58().slice(0, 8)}`;
    log.info({ bundleId, mint: req.mintKeypair.publicKey.toBase58() }, "[DRY_RUN] Skipping Jito bundle submission");
    return { bundleId, status: "Landed" };
  }

  // No internal retry — caller retries with fresh PumpPortal txs (new blockhash)
  {
      const signedTxs: string[] = [];

      for (let i = 0; i < req.txsBase58.length; i++) {
        const txBytes = bs58.decode(req.txsBase58[i]);
        const tx = VersionedTransaction.deserialize(txBytes);

        if (i === 0) {
          // Create tx: sign with both mint keypair and deployer
          tx.sign([req.mintKeypair, req.deployerKeypair]);
        } else {
          // Buy tx: sign with deployer only
          tx.sign([req.deployerKeypair]);
        }

        signedTxs.push(bs58.encode(tx.serialize()));
      }

      log.info(
        { txCount: signedTxs.length, mint: req.mintKeypair.publicKey.toBase58() },
        "Transactions signed, submitting bundle to Jito",
      );

      // Try each Jito endpoint until one succeeds
      let lastError: Error | undefined;
      for (const endpoint of JITO_ENDPOINTS) {
        try {
          log.info({ endpoint }, "Submitting bundle");
          const bundleId = await submitToEndpoint(endpoint, signedTxs);
          log.info({ bundleId, endpoint }, "Bundle submitted, polling status");

          const status = await pollBundleStatus(endpoint, bundleId);
          log.info({ bundleId, status }, "Bundle result");

          if (status === "Landed") {
            return { bundleId, status };
          }

          lastError = new Error(`Bundle ${bundleId} failed to land`);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          log.warn({ endpoint, error: lastError.message }, "Jito endpoint failed, trying next");
        }
      }

      throw lastError ?? new Error("All Jito endpoints failed");
  }
}
