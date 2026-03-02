/**
 * Collect SOL from HD sub-wallets back to master wallet.
 *
 * Leaves rent-exempt minimum (0.00089 SOL) + tx fee in each wallet.
 * Only sweeps wallets with balance above the minimum.
 *
 * Usage:
 *   pnpm tsx scripts/collect-funds.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import bs58 from "bs58";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const HD_DERIVATION_BASE = "m/44'/501'";

// Rent-exempt minimum for a 0-data account + fee buffer
const RENT_EXEMPT_LAMPORTS = 890_880; // ~0.00089 SOL
const TX_FEE_LAMPORTS = 5_000;        // 5000 lamports per signature
const MIN_SWEEP_LAMPORTS = RENT_EXEMPT_LAMPORTS + TX_FEE_LAMPORTS + 1_000; // don't bother if dust

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function deriveKeypair(mnemonic: string, index: number): { keypair: Keypair; path: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const derivationPath = `${HD_DERIVATION_BASE}/${index}'/0'`;
  const derived = derivePath(derivationPath, seed.toString("hex"));
  return { keypair: Keypair.fromSeed(derived.key), path: derivationPath };
}

async function main() {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const masterKey = requireEnv("MASTER_WALLET_PRIVATE_KEY");
  const mnemonic = requireEnv("HD_WALLET_MNEMONIC");
  const poolSize = parseInt(process.env.WALLET_POOL_SIZE || "20", 10);

  const connection = new Connection(rpcUrl, "confirmed");
  const masterKeypair = Keypair.fromSecretKey(bs58.decode(masterKey));
  const masterPubkey = masterKeypair.publicKey;

  console.log(`Master wallet: ${masterPubkey.toBase58()}`);
  console.log(`Pool size: ${poolSize}`);
  console.log("---");

  // Derive all sub-wallet keypairs
  const subWallets: { keypair: Keypair; index: number }[] = [];
  for (let i = 0; i < poolSize; i++) {
    const { keypair } = deriveKeypair(mnemonic, i);
    subWallets.push({ keypair, index: i });
  }

  // Batch-fetch balances
  const accountInfos = await connection.getMultipleAccountsInfo(
    subWallets.map((w) => w.keypair.publicKey)
  );

  let totalCollected = 0;
  let walletsSwept = 0;

  for (let i = 0; i < subWallets.length; i++) {
    const w = subWallets[i];
    const lamports = accountInfos[i]?.lamports ?? 0;
    const sol = lamports / LAMPORTS_PER_SOL;

    if (lamports < MIN_SWEEP_LAMPORTS) {
      console.log(
        `  Wallet #${w.index} ${w.keypair.publicKey.toBase58().slice(0, 8)}... — ${sol.toFixed(4)} SOL (skip, below minimum)`
      );
      continue;
    }

    // Sweep: balance - rent_exempt - tx_fee
    const sweepLamports = lamports - RENT_EXEMPT_LAMPORTS - TX_FEE_LAMPORTS;
    if (sweepLamports <= 0) continue;

    const sweepSol = sweepLamports / LAMPORTS_PER_SOL;

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: w.keypair.publicKey,
        toPubkey: masterPubkey,
        lamports: sweepLamports,
      })
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [w.keypair]);
      console.log(
        `  Wallet #${w.index} ${w.keypair.publicKey.toBase58().slice(0, 8)}... — swept ${sweepSol.toFixed(4)} SOL (had ${sol.toFixed(4)})`
      );
      console.log(`    Tx: ${sig}`);
      totalCollected += sweepSol;
      walletsSwept++;
    } catch (err) {
      console.error(
        `  Wallet #${w.index} ${w.keypair.publicKey.toBase58().slice(0, 8)}... — sweep failed:`,
        err
      );
    }
  }

  console.log(`\nDone. Swept ${walletsSwept} wallets, collected ${totalCollected.toFixed(4)} SOL to master.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
