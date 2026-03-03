import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getEnv } from "@flash-pump/shared";
import bs58 from "bs58";

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(getEnv().SOLANA_RPC_URL, "confirmed");
  }
  return _connection;
}

export async function getWalletBalance(address: string): Promise<number> {
  try {
    const connection = getConnection();
    const pubkey = new PublicKey(address);
    const lamports = await connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

export async function getMultipleBalances(
  addresses: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (addresses.length === 0) return result;

  const connection = getConnection();
  const pubkeys = addresses.map((a) => new PublicKey(a));

  try {
    const accounts = await connection.getMultipleAccountsInfo(pubkeys);
    for (let i = 0; i < addresses.length; i++) {
      const account = accounts[i];
      result.set(addresses[i], account ? account.lamports / LAMPORTS_PER_SOL : 0);
    }
  } catch {
    for (const addr of addresses) {
      result.set(addr, 0);
    }
  }

  return result;
}

/** Get the master wallet address from the private key env var */
export function getMasterWalletAddress(): string {
  const secretKey = bs58.decode(getEnv().MASTER_WALLET_PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(secretKey);
  return keypair.publicKey.toBase58();
}

// --- Bonding Curve (inlined from exit-manager/monitor.ts) ---

const PUMPFUN_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);
const BONDING_CURVE_TARGET_LAMPORTS = 85_000_000_000;

export interface BondingCurveSnapshot {
  mintAddress: string;
  bondingProgress: number;
  pricePerToken: number;
}

export async function fetchBondingCurveState(
  mintAddress: string,
): Promise<BondingCurveSnapshot | null> {
  try {
    const connection = getConnection();
    const mint = new PublicKey(mintAddress);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMPFUN_PROGRAM_ID,
    );

    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo?.data || accountInfo.data.length < 49) return null;

    const data = Buffer.from(accountInfo.data);
    const offset = 8; // skip discriminator

    const virtualTokenReserves = data.readBigUInt64LE(offset);
    const virtualSolReserves = data.readBigUInt64LE(offset + 8);
    const realSolReserves = data.readBigUInt64LE(offset + 24);

    const realSolLamports = Number(realSolReserves);
    const bondingProgress = Math.min(
      (realSolLamports / BONDING_CURVE_TARGET_LAMPORTS) * 100,
      100,
    );

    const vSol = Number(virtualSolReserves);
    const vToken = Number(virtualTokenReserves);
    const pricePerToken = vToken > 0 ? vSol / vToken : 0;

    return { mintAddress, bondingProgress, pricePerToken };
  } catch {
    return null;
  }
}
