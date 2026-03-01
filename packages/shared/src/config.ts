import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Solana
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string(),
  HELIUS_API_KEY: z.string().min(1),

  // Wallet
  MASTER_WALLET_PRIVATE_KEY: z.string().min(1),
  HD_WALLET_MNEMONIC: z.string().min(1),

  // AI
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
  OPENAI_API_KEY: z.string().startsWith("sk-"),

  // X.com
  X_API_BEARER_TOKEN: z.string().min(1),
  X_USERNAME: z.string().optional(),
  X_PASSWORD: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // pump.fun
  PUMPFUN_PROGRAM_ID: z.string().default(
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
  ),

  // Config
  TREND_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  INITIAL_BUY_SOL: z.coerce.number().positive().default(0.1),
  MAX_DAILY_LAUNCHES: z.coerce.number().int().positive().default(20),
  EXIT_STAGE1_MULTIPLIER: z.coerce.number().positive().default(3),
  EXIT_STAGE2_BONDING_PCT: z.coerce.number().min(0).max(100).default(70),
  EXIT_TRAILING_STOP_PCT: z.coerce.number().min(0).max(100).default(30),
  WALLET_POOL_SIZE: z.coerce.number().int().positive().default(20),
  WALLET_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error("Invalid environment variables:");
      console.error(result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}
