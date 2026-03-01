import {
  Keypair,
  Connection,
  VersionedTransaction,
} from "@solana/web3.js";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { createLogger } from "@flash-pump/shared";
import {
  PUMP_PORTAL_URL,
  HD_DERIVATION_BASE,
  SELL_SLIPPAGE_BPS,
  TX_CONFIRM_TIMEOUT_MS,
} from "./constants";
import { withRetry } from "./retry";

const log = createLogger("seller");

/** Derived wallet pool — address → keypair lookup */
let walletMap: Map<string, Keypair> = new Map();
let initialized = false;

/** Derive all keypairs from mnemonic once at startup */
export function initWalletDeriver(mnemonic: string, poolSize: number): void {
  if (initialized) return;

  const seed = mnemonicToSeedSync(mnemonic);
  walletMap = new Map();

  for (let i = 0; i < poolSize; i++) {
    const path = `${HD_DERIVATION_BASE}/${i}'/0'`;
    const derived = derivePath(path, seed.toString("hex"));
    const keypair = Keypair.fromSeed(derived.key);
    walletMap.set(keypair.publicKey.toBase58(), keypair);
  }

  initialized = true;
  log.info({ poolSize, wallets: walletMap.size }, "Wallet deriver initialized");
}

/** Lookup keypair by wallet address */
export function getKeypairForWallet(address: string): Keypair {
  const keypair = walletMap.get(address);
  if (!keypair) {
    throw new Error(`Wallet not in derived pool: ${address}`);
  }
  return keypair;
}

export interface SellResult {
  txSignature: string;
  solReceived: number;
}

/**
 * Execute a sell on pump.fun via PumpPortal API.
 * Steps:
 *  1. POST to PumpPortal to get unsigned VersionedTransaction
 *  2. Sign with the wallet keypair
 *  3. Submit via connection.sendRawTransaction
 *  4. Confirm transaction
 */
export async function executePumpSell(
  mintAddress: string,
  walletAddress: string,
  tokenAmount: bigint,
  connection: Connection,
): Promise<SellResult> {
  const keypair = getKeypairForWallet(walletAddress);

  return withRetry(
    async () => {
      log.info(
        { mintAddress, wallet: walletAddress, tokenAmount: tokenAmount.toString() },
        "Executing pump.fun sell",
      );

      // 1. Request unsigned sell transaction from PumpPortal
      const body = {
        publicKey: walletAddress,
        action: "sell",
        mint: mintAddress,
        denominatedInSol: "false",
        amount: tokenAmount.toString(),
        slippage: SELL_SLIPPAGE_BPS / 100, // PumpPortal takes percentage
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
        throw new Error(`PumpPortal sell API error (${res.status}): ${errBody}`);
      }

      // 2. Deserialize and sign
      const txBuffer = Buffer.from(await res.arrayBuffer());
      const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));
      tx.sign([keypair]);

      // 3. Submit to Solana
      const txSignature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });

      log.info({ txSignature, mintAddress }, "Sell transaction submitted");

      // 4. Confirm
      const confirmation = await connection.confirmTransaction(
        txSignature,
        "confirmed",
      );

      if (confirmation.value.err) {
        throw new Error(`Sell tx failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
      }

      // 5. Estimate SOL received from post-tx balance change
      //    (actual amount parsed from tx logs would be more precise,
      //     but balance diff is simpler and good enough for tracking)
      const solReceived = 0; // Will be updated by exit-engine from balance diff

      log.info(
        { txSignature, mintAddress, tokenAmount: tokenAmount.toString() },
        "Sell confirmed",
      );

      return { txSignature, solReceived };
    },
    { maxAttempts: 3, label: `pumpSell(${mintAddress.slice(0, 8)})` },
  );
}
