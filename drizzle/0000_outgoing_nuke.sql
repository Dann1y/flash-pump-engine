CREATE TYPE "public"."token_status" AS ENUM('deploying', 'active', 'exiting', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."trade_type" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trend_status" AS ENUM('detected', 'launched', 'skipped', 'expired');--> statement-breakpoint
CREATE TABLE "daily_pnl" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_pnl_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"date" date NOT NULL,
	"tokens_launched" integer DEFAULT 0,
	"tokens_hit" integer DEFAULT 0,
	"tokens_raydium" integer DEFAULT 0,
	"total_cost_sol" real DEFAULT 0,
	"total_revenue_sol" real DEFAULT 0,
	"net_pnl_sol" real DEFAULT 0,
	"hit_rate" real DEFAULT 0,
	CONSTRAINT "daily_pnl_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trend_id" integer,
	"mint_address" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"description" text,
	"image_url" text,
	"deploy_wallet" varchar(64) NOT NULL,
	"deploy_tx" varchar(128),
	"initial_buy_sol" real,
	"initial_buy_tokens" bigint,
	"status" "token_status" DEFAULT 'deploying',
	"bonding_progress" real DEFAULT 0,
	"raydium_migrated" boolean DEFAULT false,
	"launched_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "tokens_mint_address_unique" UNIQUE("mint_address")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_id" integer,
	"type" "trade_type" NOT NULL,
	"sol_amount" real NOT NULL,
	"token_amount" bigint NOT NULL,
	"price_per_token" real,
	"wallet" varchar(64) NOT NULL,
	"tx_signature" varchar(128),
	"exit_stage" integer,
	"executed_at" timestamp DEFAULT now(),
	CONSTRAINT "trades_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "trends" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trends_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"keyword" varchar(200) NOT NULL,
	"score" real NOT NULL,
	"context" jsonb,
	"source" varchar(50) DEFAULT 'x.com',
	"status" "trend_status" DEFAULT 'detected',
	"detected_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"address" varchar(64) NOT NULL,
	"derivation_path" varchar(50),
	"sol_balance" real DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_trend_id_trends_id_fk" FOREIGN KEY ("trend_id") REFERENCES "public"."trends"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;