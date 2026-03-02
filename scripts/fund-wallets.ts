/**
 * Distribute SOL from master wallet to HD sub-wallets.
 *
 * Only funds wallets whose on-chain balance is below the target.
 *
 * Usage:
 *   pnpm tsx scripts/fund-wallets.ts          # default 0.25 SOL per wallet
 *   pnpm tsx scripts/fund-wallets.ts 0.5      # 0.5 SOL per wallet
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
  const targetSol = parseFloat(process.argv[2] || "0.25");
  if (isNaN(targetSol) || targetSol <= 0) {
    console.error("Usage: fund-wallets.ts [targetSOL]  (positive number)");
    process.exit(1);
  }

  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const masterKey = requireEnv("MASTER_WALLET_PRIVATE_KEY");
  const mnemonic = requireEnv("HD_WALLET_MNEMONIC");
  const poolSize = parseInt(process.env.WALLET_POOL_SIZE || "20", 10);

  const connection = new Connection(rpcUrl, "confirmed");
  const masterKeypair = Keypair.fromSecretKey(bs58.decode(masterKey));

  console.log(`Master wallet: ${masterKeypair.publicKey.toBase58()}`);
  const masterBalance = await connection.getBalance(masterKeypair.publicKey);
  console.log(`Master balance: ${(masterBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Target per wallet: ${targetSol} SOL`);
  console.log(`Pool size: ${poolSize}`);
  console.log("---");

  // Derive all sub-wallet pubkeys
  const subWallets: { pubkey: PublicKey; index: number }[] = [];
  for (let i = 0; i < poolSize; i++) {
    const { keypair } = deriveKeypair(mnemonic, i);
    subWallets.push({ pubkey: keypair.publicKey, index: i });
  }

  // Batch-fetch balances
  const accountInfos = await connection.getMultipleAccountsInfo(
    subWallets.map((w) => w.pubkey)
  );

  const targetLamports = Math.ceil(targetSol * LAMPORTS_PER_SOL);
  let totalNeeded = 0;
  const toFund: { pubkey: PublicKey; index: number; currentSol: number; needed: number }[] = [];

  for (let i = 0; i < subWallets.length; i++) {
    const lamports = accountInfos[i]?.lamports ?? 0;
    const currentSol = lamports / LAMPORTS_PER_SOL;
    const deficit = targetLamports - lamports;

    if (deficit > 0) {
      toFund.push({
        pubkey: subWallets[i].pubkey,
        index: subWallets[i].index,
        currentSol,
        needed: deficit / LAMPORTS_PER_SOL,
      });
      totalNeeded += deficit;
    } else {
      console.log(
        `  Wallet #${i} ${subWallets[i].pubkey.toBase58().slice(0, 8)}... — ${currentSol.toFixed(4)} SOL (OK)`
      );
    }
  }

  if (toFund.length === 0) {
    console.log("\nAll wallets already at or above target. Nothing to do.");
    return;
  }

  console.log(`\n${toFund.length} wallets need funding. Total: ${(totalNeeded / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (totalNeeded > masterBalance - 5000) {
    // 5000 lamports for fee buffer
    console.error(
      `ERROR: Master wallet has insufficient balance. Need ${(totalNeeded / LAMPORTS_PER_SOL).toFixed(4)} SOL but only ${(masterBalance / LAMPORTS_PER_SOL).toFixed(4)} available.`
    );
    process.exit(1);
  }

  // Send transfers — batch into transactions (max ~20 transfers per tx to stay under size limit)
  const BATCH_SIZE = 20;
  let funded = 0;
  let totalSent = 0;

  for (let batch = 0; batch < toFund.length; batch += BATCH_SIZE) {
    const chunk = toFund.slice(batch, batch + BATCH_SIZE);
    const tx = new Transaction();

    for (const w of chunk) {
      const lamports = Math.ceil(w.needed * LAMPORTS_PER_SOL);
      tx.add(
        SystemProgram.transfer({
          fromPubkey: masterKeypair.publicKey,
          toPubkey: w.pubkey,
          lamports,
        })
      );
    }

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [masterKeypair]);
      for (const w of chunk) {
        console.log(
          `  Wallet #${w.index} ${w.pubkey.toBase58().slice(0, 8)}... — sent ${w.needed.toFixed(4)} SOL (was ${w.currentSol.toFixed(4)})`
        );
        funded++;
        totalSent += w.needed;
      }
      console.log(`  Tx: ${sig}`);
    } catch (err) {
      console.error(`  Batch transfer failed:`, err);
    }
  }

  console.log(`\nDone. Funded ${funded}/${toFund.length} wallets, sent ${totalSent.toFixed(4)} SOL total.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
