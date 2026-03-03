/**
 * Liquidate all active tokens and sweep SOL back to master wallet.
 *
 * Steps:
 *  1. Query DB for tokens with status in ('active', 'exiting', 'deploying')
 *  2. For each token, check SPL balance and sell via PumpPortal
 *  3. Update DB status to 'completed'
 *  4. Wait for settlement
 *  5. Sweep all sub-wallet SOL to master wallet
 *
 * Usage:
 *   pnpm tsx scripts/liquidate-all.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { eq, inArray } from "drizzle-orm";
import bs58 from "bs58";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Reuse DB client from shared — it reads DATABASE_URL from process.env
import { getDb, closeDb } from "@flash-pump/shared/src/db/client";
import { tokens } from "@flash-pump/shared/src/db/schema";

// --- Constants ---

const PUMP_PORTAL_URL = "https://pumpportal.fun/api/trade-local";
const SELL_SLIPPAGE_PCT = 15; // 15% for meme coins
const HD_DERIVATION_BASE = "m/44'/501'";
const RENT_EXEMPT_LAMPORTS = 890_880;
const TX_FEE_LAMPORTS = 5_000;
const MIN_SWEEP_LAMPORTS = RENT_EXEMPT_LAMPORTS + TX_FEE_LAMPORTS + 1_000;
const SETTLEMENT_DELAY_MS = 5_000;

// --- Helpers ---

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function deriveKeypair(mnemonic: string, index: number): Keypair {
  const seed = mnemonicToSeedSync(mnemonic);
  const derivationPath = `${HD_DERIVATION_BASE}/${index}'/0'`;
  const derived = derivePath(derivationPath, seed.toString("hex"));
  return Keypair.fromSeed(derived.key);
}

function buildWalletMap(mnemonic: string, poolSize: number): Map<string, Keypair> {
  const map = new Map<string, Keypair>();
  for (let i = 0; i < poolSize; i++) {
    const kp = deriveKeypair(mnemonic, i);
    map.set(kp.publicKey.toBase58(), kp);
  }
  return map;
}

async function getTokenBalance(
  connection: Connection,
  walletPubkey: PublicKey,
  mintPubkey: PublicKey,
): Promise<bigint> {
  const resp = await connection.getTokenAccountsByOwner(walletPubkey, {
    mint: mintPubkey,
  });

  if (resp.value.length === 0) return 0n;

  const accountData = AccountLayout.decode(resp.value[0].account.data);
  return accountData.amount;
}

async function sellToken(
  connection: Connection,
  keypair: Keypair,
  mintAddress: string,
  tokenAmount: bigint,
): Promise<string> {
  const body = {
    publicKey: keypair.publicKey.toBase58(),
    action: "sell",
    mint: mintAddress,
    denominatedInSol: "false",
    amount: tokenAmount.toString(),
    slippage: SELL_SLIPPAGE_PCT,
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
    throw new Error(`PumpPortal sell error (${res.status}): ${errBody}`);
  }

  const txBuffer = Buffer.from(await res.arrayBuffer());
  const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));
  tx.sign([keypair]);

  const txSignature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });

  await connection.confirmTransaction(txSignature, "confirmed");
  return txSignature;
}

// --- Main ---

async function main() {
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const masterKey = requireEnv("MASTER_WALLET_PRIVATE_KEY");
  const mnemonic = requireEnv("HD_WALLET_MNEMONIC");
  const poolSize = parseInt(process.env.WALLET_POOL_SIZE || "20", 10);

  const connection = new Connection(rpcUrl, "confirmed");
  const masterKeypair = Keypair.fromSecretKey(bs58.decode(masterKey));
  const masterPubkey = masterKeypair.publicKey;
  const walletMap = buildWalletMap(mnemonic, poolSize);

  console.log(`Master wallet: ${masterPubkey.toBase58()}`);
  console.log(`Wallet pool size: ${poolSize}`);
  console.log();

  // --- Step 1: Query active tokens ---

  const db = getDb();
  const activeTokens = await db
    .select()
    .from(tokens)
    .where(inArray(tokens.status, ["active", "exiting", "deploying"]));

  console.log(`Found ${activeTokens.length} active token(s) to liquidate`);
  console.log("---");

  // --- Step 2: Sell each token ---

  let soldCount = 0;
  let failCount = 0;

  for (const token of activeTokens) {
    const { mintAddress, deployWallet, name, ticker, id } = token;

    const keypair = walletMap.get(deployWallet);
    if (!keypair) {
      console.error(`  [${ticker}] Wallet ${deployWallet.slice(0, 8)}... not in derived pool — skipping`);
      failCount++;
      continue;
    }

    const mintPubkey = new PublicKey(mintAddress);
    const walletPubkey = keypair.publicKey;

    // Check SPL token balance
    let balance: bigint;
    try {
      balance = await getTokenBalance(connection, walletPubkey, mintPubkey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${ticker}] Failed to fetch token balance: ${msg}`);
      // If mint doesn't exist on-chain, token is unsellable — mark as failed
      if (msg.includes("could not find mint") || msg.includes("Invalid param")) {
        console.log(`  [${ticker}] Mint not found on-chain, marking as failed`);
        await db.update(tokens).set({ status: "failed" }).where(eq(tokens.id, id));
      }
      failCount++;
      continue;
    }

    if (balance === 0n) {
      console.log(`  [${ticker}] ${name} — no tokens held, marking completed`);
      await db.update(tokens).set({ status: "completed" }).where(eq(tokens.id, id));
      continue;
    }

    console.log(`  [${ticker}] ${name} — balance: ${balance.toLocaleString()} tokens`);

    // Sell via PumpPortal
    try {
      const txSig = await sellToken(connection, keypair, mintAddress, balance);
      console.log(`  [${ticker}] Sold! Tx: ${txSig}`);
      soldCount++;

      await db.update(tokens).set({ status: "completed" }).where(eq(tokens.id, id));
    } catch (err) {
      console.error(`  [${ticker}] Sell failed:`, err instanceof Error ? err.message : err);
      failCount++;

      // Still mark completed if the token is unsellable
      await db.update(tokens).set({ status: "failed" }).where(eq(tokens.id, id));
    }
  }

  console.log();
  console.log(`Sell summary: ${soldCount} sold, ${failCount} failed, ${activeTokens.length - soldCount - failCount} empty`);

  // --- Step 3: Wait for settlement ---

  if (soldCount > 0) {
    console.log(`\nWaiting ${SETTLEMENT_DELAY_MS / 1000}s for settlement...`);
    await new Promise((resolve) => setTimeout(resolve, SETTLEMENT_DELAY_MS));
  }

  // --- Step 4: Sweep SOL to master ---

  console.log("\n--- SOL Sweep ---");

  const subWallets = Array.from(walletMap.values());
  const accountInfos = await connection.getMultipleAccountsInfo(
    subWallets.map((kp) => kp.publicKey),
  );

  let totalCollected = 0;
  let walletsSwept = 0;

  for (let i = 0; i < subWallets.length; i++) {
    const kp = subWallets[i];
    const lamports = accountInfos[i]?.lamports ?? 0;
    const sol = lamports / LAMPORTS_PER_SOL;

    if (lamports < MIN_SWEEP_LAMPORTS) {
      if (lamports > 0) {
        console.log(`  ${kp.publicKey.toBase58().slice(0, 8)}... — ${sol.toFixed(4)} SOL (skip, below minimum)`);
      }
      continue;
    }

    const sweepLamports = lamports - RENT_EXEMPT_LAMPORTS - TX_FEE_LAMPORTS;
    if (sweepLamports <= 0) continue;

    const sweepSol = sweepLamports / LAMPORTS_PER_SOL;

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: masterPubkey,
        lamports: sweepLamports,
      }),
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [kp]);
      console.log(`  ${kp.publicKey.toBase58().slice(0, 8)}... — swept ${sweepSol.toFixed(4)} SOL`);
      console.log(`    Tx: ${sig}`);
      totalCollected += sweepSol;
      walletsSwept++;
    } catch (err) {
      console.error(
        `  ${kp.publicKey.toBase58().slice(0, 8)}... — sweep failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // --- Step 5: Summary ---

  console.log("\n=== Liquidation Complete ===");
  console.log(`Tokens sold: ${soldCount}`);
  console.log(`Sell failures: ${failCount}`);
  console.log(`Wallets swept: ${walletsSwept}`);
  console.log(`SOL collected: ${totalCollected.toFixed(4)} SOL`);

  await closeDb();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
