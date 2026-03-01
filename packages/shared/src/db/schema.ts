import {
  pgTable,
  varchar,
  real,
  jsonb,
  timestamp,
  integer,
  text,
  bigint,
  boolean,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";

// --- Enums ---

export const trendStatusEnum = pgEnum("trend_status", [
  "detected",
  "launched",
  "skipped",
  "expired",
]);

export const tokenStatusEnum = pgEnum("token_status", [
  "deploying",
  "active",
  "exiting",
  "completed",
  "failed",
]);

export const tradeTypeEnum = pgEnum("trade_type", ["buy", "sell"]);

// --- Tables ---

export const trends = pgTable("trends", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  keyword: varchar({ length: 200 }).notNull(),
  score: real().notNull(),
  context: jsonb(),
  source: varchar({ length: 50 }).default("x.com"),
  status: trendStatusEnum().default("detected"),
  detectedAt: timestamp("detected_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tokens = pgTable("tokens", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  trendId: integer("trend_id").references(() => trends.id),
  mintAddress: varchar("mint_address", { length: 64 }).unique().notNull(),
  name: varchar({ length: 100 }).notNull(),
  ticker: varchar({ length: 20 }).notNull(),
  description: text(),
  imageUrl: text("image_url"),
  deployWallet: varchar("deploy_wallet", { length: 64 }).notNull(),
  deployTx: varchar("deploy_tx", { length: 128 }),
  initialBuySol: real("initial_buy_sol"),
  initialBuyTokens: bigint("initial_buy_tokens", { mode: "bigint" }),
  status: tokenStatusEnum().default("deploying"),
  bondingProgress: real("bonding_progress").default(0),
  raydiumMigrated: boolean("raydium_migrated").default(false),
  launchedAt: timestamp("launched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const trades = pgTable("trades", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tokenId: integer("token_id").references(() => tokens.id),
  type: tradeTypeEnum().notNull(),
  solAmount: real("sol_amount").notNull(),
  tokenAmount: bigint("token_amount", { mode: "bigint" }).notNull(),
  pricePerToken: real("price_per_token"),
  wallet: varchar({ length: 64 }).notNull(),
  txSignature: varchar("tx_signature", { length: 128 }).unique(),
  exitStage: integer("exit_stage"),
  executedAt: timestamp("executed_at").defaultNow(),
});

export const wallets = pgTable("wallets", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  address: varchar({ length: 64 }).unique().notNull(),
  derivationPath: varchar("derivation_path", { length: 50 }),
  solBalance: real("sol_balance").default(0),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dailyPnl = pgTable("daily_pnl", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  date: date().unique().notNull(),
  tokensLaunched: integer("tokens_launched").default(0),
  tokensHit: integer("tokens_hit").default(0),
  tokensRaydium: integer("tokens_raydium").default(0),
  totalCostSol: real("total_cost_sol").default(0),
  totalRevenueSol: real("total_revenue_sol").default(0),
  netPnlSol: real("net_pnl_sol").default(0),
  hitRate: real("hit_rate").default(0),
});
