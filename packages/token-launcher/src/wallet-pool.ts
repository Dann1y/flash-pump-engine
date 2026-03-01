import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { getDb, getEnv, createLogger, wallets } from "@flash-pump/shared";
import { eq } from "drizzle-orm";
import { ANTI_DETECTION, HD_DERIVATION_BASE } from "./constants";

const log = createLogger("wallet-pool");

interface PoolWallet {
  keypair: Keypair;
  address: string;
  derivationPath: string;
  lastUsedAt: Date | null;
}

let pool: PoolWallet[] = [];
let initialized = false;

/** Derive a Solana keypair from mnemonic + index */
function deriveKeypair(mnemonic: string, index: number): { keypair: Keypair; path: string } {
  const seed = mnemonicToSeedSync(mnemonic);
  const path = `${HD_DERIVATION_BASE}/${index}'/0'`;
  const derived = derivePath(path, seed.toString("hex"));
  const keypair = Keypair.fromSeed(derived.key);
  return { keypair, path };
}

/** Initialize the wallet pool — derive keypairs and upsert to DB */
export async function initWalletPool(): Promise<void> {
  if (initialized) return;

  const env = getEnv();
  const db = getDb();
  const poolSize = env.WALLET_POOL_SIZE;

  log.info({ poolSize }, "Initializing wallet pool");

  pool = [];
  for (let i = 0; i < poolSize; i++) {
    const { keypair, path } = deriveKeypair(env.HD_WALLET_MNEMONIC, i);
    pool.push({
      keypair,
      address: keypair.publicKey.toBase58(),
      derivationPath: path,
      lastUsedAt: null,
    });
  }

  // Upsert wallets to DB
  for (const w of pool) {
    const existing = await db
      .select()
      .from(wallets)
      .where(eq(wallets.address, w.address))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(wallets).values({
        address: w.address,
        derivationPath: w.derivationPath,
        solBalance: 0,
        isActive: true,
      });
    } else {
      // Sync lastUsedAt from DB
      w.lastUsedAt = existing[0].lastUsedAt;
    }
  }

  initialized = true;
  log.info({ count: pool.length }, "Wallet pool initialized");
}

/** Refresh on-chain SOL balances for all wallets */
export async function refreshBalances(): Promise<void> {
  const env = getEnv();
  const db = getDb();
  const connection = new Connection(env.SOLANA_RPC_URL);

  const pubkeys = pool.map((w) => w.keypair.publicKey);
  const balances = await connection.getMultipleAccountsInfo(pubkeys);

  for (let i = 0; i < pool.length; i++) {
    const lamports = balances[i]?.lamports ?? 0;
    const sol = lamports / LAMPORTS_PER_SOL;

    await db
      .update(wallets)
      .set({ solBalance: sol })
      .where(eq(wallets.address, pool[i].address));
  }

  log.info("Wallet balances refreshed");
}

/** Get an available wallet: not on cooldown, has sufficient SOL, random pick */
export async function getAvailableWallet(minSol: number): Promise<PoolWallet> {
  const env = getEnv();
  const cooldownMs = (env.WALLET_COOLDOWN_MINUTES ?? ANTI_DETECTION.walletCooldownMin) * 60 * 1000;
  const now = Date.now();
  const connection = new Connection(env.SOLANA_RPC_URL);

  // Filter wallets off cooldown
  const candidates = pool.filter((w) => {
    if (w.lastUsedAt && now - w.lastUsedAt.getTime() < cooldownMs) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    throw new Error("No wallets available — all on cooldown");
  }

  // Shuffle and find one with sufficient balance
  const shuffled = candidates.sort(() => Math.random() - 0.5);

  for (const w of shuffled) {
    const balance = await connection.getBalance(w.keypair.publicKey);
    const sol = balance / LAMPORTS_PER_SOL;
    if (sol >= minSol) {
      log.info({ wallet: w.address, balance: sol }, "Selected wallet");
      return w;
    }
  }

  throw new Error(`No wallets with sufficient balance (need ${minSol} SOL)`);
}

/** Mark a wallet as used — update cooldown timestamp */
export async function markWalletUsed(address: string): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .update(wallets)
    .set({ lastUsedAt: now })
    .where(eq(wallets.address, address));

  const w = pool.find((w) => w.address === address);
  if (w) w.lastUsedAt = now;

  log.info({ wallet: address }, "Wallet marked as used");
}

/** Get keypair by address */
export function getKeypairByAddress(address: string): Keypair {
  const w = pool.find((w) => w.address === address);
  if (!w) throw new Error(`Wallet not in pool: ${address}`);
  return w.keypair;
}
