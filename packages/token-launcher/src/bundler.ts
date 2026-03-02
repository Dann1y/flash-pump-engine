import {
  Keypair,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
  TransactionMessage,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { createLogger, getEnv } from "@flash-pump/shared";
import { JITO_ENDPOINTS, JITO_TIP_ACCOUNTS, ANTI_DETECTION } from "./constants";
import { withRetry } from "./retry";

const log = createLogger("bundler");

/** Randomize Jito tip within anti-detection bounds */
function randomTipLamports(): number {
  const { minTipSol, maxTipSol } = ANTI_DETECTION;
  const tipSol = minTipSol + Math.random() * (maxTipSol - minTipSol);
  return Math.round(tipSol * LAMPORTS_PER_SOL);
}

/** Pick a random Jito tip account */
function randomTipAccount(): PublicKey {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

/** Build a tip transaction for Jito */
async function buildTipTransaction(
  payer: Keypair,
  connection: Connection,
): Promise<VersionedTransaction> {
  const tipLamports = randomTipLamports();
  const tipAccount = randomTipAccount();

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const instruction = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: tipAccount,
    lamports: tipLamports,
  });

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);

  log.info(
    { tipSol: tipLamports / LAMPORTS_PER_SOL, tipAccount: tipAccount.toBase58() },
    "Tip transaction built",
  );

  return tx;
}

/** Sign a PumpPortal transaction with the required keypairs */
function signTransaction(
  txBase64: string,
  signers: Keypair[],
): VersionedTransaction {
  const txBytes = Buffer.from(txBase64, "base64");
  const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
  tx.sign(signers);
  return tx;
}

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
  /** Base64-encoded unsigned create+buy transaction from PumpPortal */
  createTxBase64: string;
  /** Mint keypair (must sign the create tx) */
  mintKeypair: Keypair;
  /** Deployer wallet keypair (pays for everything) */
  deployerKeypair: Keypair;
}

export interface BundleResult {
  bundleId: string;
  status: "Landed" | "Failed";
}

/**
 * Sign transactions, build Jito tip, submit bundle with endpoint failover.
 * Retries up to 3 times with fresh blockhash each attempt.
 */
export async function submitBundle(req: BundleRequest): Promise<BundleResult> {
  const env = getEnv();

  if (env.DRY_RUN) {
    const bundleId = `dry-run-${Date.now()}-${req.mintKeypair.publicKey.toBase58().slice(0, 8)}`;
    log.info({ bundleId, mint: req.mintKeypair.publicKey.toBase58() }, "[DRY_RUN] Skipping Jito bundle submission");
    return { bundleId, status: "Landed" };
  }

  const connection = new Connection(env.SOLANA_RPC_URL);

  return withRetry(
    async () => {
      // 1. Sign the PumpPortal transaction
      const signedCreateTx = signTransaction(req.createTxBase64, [
        req.deployerKeypair,
        req.mintKeypair,
      ]);

      // 2. Build tip transaction (fresh blockhash each attempt)
      const tipTx = await buildTipTransaction(req.deployerKeypair, connection);

      // 3. Serialize both transactions
      const serializedTxs = [
        bs58.encode(signedCreateTx.serialize()),
        bs58.encode(tipTx.serialize()),
      ];

      // 4. Try each Jito endpoint until one succeeds
      let lastError: Error | undefined;
      for (const endpoint of JITO_ENDPOINTS) {
        try {
          log.info({ endpoint }, "Submitting bundle to Jito");
          const bundleId = await submitToEndpoint(endpoint, serializedTxs);
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
    },
    { maxAttempts: 3, label: "submitBundle" },
  );
}
