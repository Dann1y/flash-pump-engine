# Flash Pump Engine

> End-to-end automation pipeline that detects real-time trends from X.com (Twitter), scores meme coin potential with AI, auto-launches tokens on pump.fun, and realizes profit through staged sells.

## Architecture

```
X.com ──► trend-detector ──► token-launcher ──► exit-manager
           (scrape+AI)       (deploy+bundle)    (monitor+sell)
               │                   │                  │
               ▼                   ▼                  ▼
           ┌───────┐          ┌────────┐         ┌────────┐
           │ Redis │◄────────►│ Postgres│◄───────►│ Helius │
           │ Queue │          │   DB   │         │  WSS   │
           └───────┘          └────────┘         └────────┘
               │                                      │
               ▼                                      ▼
          telegram-bot ◄──────── alerts ◄─────── events
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | TypeScript (Node.js 20+), Python 3.11+ (scraper) |
| Blockchain | @solana/web3.js, @solana/spl-token, Jito bundles |
| AI / LLM | Claude Sonnet (trend scoring + metadata), DALL-E 3 (images) |
| Database | PostgreSQL 16 (Drizzle ORM) + Redis 7 (BullMQ) |
| RPC | Helius (REST + WebSocket) |
| Alerting | Telegram Bot (grammy) |
| Infra | Docker Compose, pnpm workspaces |

## Project Structure

```
flash-pump-engine/
├── packages/
│   ├── shared/            # Types, config, DB schema, Redis, logger
│   ├── trend-detector/    # X.com trend scraping + AI scoring
│   ├── token-launcher/    # pump.fun token deploy + Jito bundling
│   ├── exit-manager/      # Position monitoring + 3-stage exit
│   └── telegram-bot/      # Alerts + dashboard commands
├── scripts/               # Wallet setup, fund distribution, collection
├── python/x-scraper/      # Playwright-based X.com scraper
└── docker-compose.yml
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- Python 3.11+ (optional, for X scraper)

### Setup

```bash
# Clone
git clone https://github.com/your-org/flash-pump-engine.git
cd flash-pump-engine

# Install dependencies
pnpm install

# Environment
cp .env.example .env
# Edit .env with your keys (Solana, Anthropic, OpenAI, Telegram, etc.)

# Start Postgres + Redis
docker compose up -d

# Run migrations
pnpm db:migrate
```

### Run Services

Each module runs independently:

```bash
# Trend detector — scrapes X.com, scores with Claude, publishes signals
pnpm --filter @flash-pump/trend-detector start

# Token launcher — consumes signals, deploys tokens on pump.fun
pnpm --filter @flash-pump/token-launcher start

# Exit manager — monitors positions, executes 3-stage exits
pnpm --filter @flash-pump/exit-manager start

# Telegram bot — alerts + commands
pnpm --filter @flash-pump/telegram-bot start
```

## Modules

### Trend Detector

Polls X.com every 30-60s for trending topics and crypto-related keywords. Each trend is scored 0.0–1.0 by Claude Sonnet based on viral potential, crypto relevance, naming suitability, timing, and visual memability. Trends scoring ≥ 0.7 pass through a duplicate/timing filter and are published to the `token-launch-queue` via BullMQ.

### Token Launcher

BullMQ worker that consumes launch signals. Generates token name/ticker/description via Claude, creates a profile image via DALL-E 3, then deploys the token on pump.fun with an atomic Jito bundle (create + initial buy). Manages an HD wallet pool with cooldown rotation and auto-replenishment.

### Exit Manager

Monitors all active positions via Helius WebSocket. Executes a 3-stage exit strategy:

| Stage | Trigger | Action |
|-------|---------|--------|
| 1 — Principal | Bonding 40-50% or 3x value | Sell initial SOL amount |
| 2 — Profit | Bonding 70%+ or Raydium imminent | Sell 50% of remaining |
| 3 — Cleanup | Post-Raydium peak or -30% trailing stop | Sell all remaining |
| Emergency | -50% from entry or 12h zero volume | Sell everything |

### Telegram Bot

Real-time alerts and control interface. Subscribes to Redis events for launch/exit/error notifications and provides commands for system management.

## Telegram Commands

| Command | Description |
|---------|------------|
| `/status` | System status — active tokens, queue depth, wallet balances |
| `/pnl` | P&L summary — today, this week, this month |
| `/tokens` | Recent token launches + current status |
| `/pause` | Pause new launches (existing exits continue) |
| `/resume` | Resume launches |
| `/config` | View/change runtime config (score threshold, exit ratios) |

## Environment Variables

See [`.env.example`](.env.example) for all required values. Grouped by service:

| Group | Variables |
|-------|----------|
| Solana | `SOLANA_RPC_URL`, `SOLANA_WS_URL`, `HELIUS_API_KEY` |
| Wallet | `MASTER_WALLET_PRIVATE_KEY`, `HD_WALLET_MNEMONIC` |
| AI | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| X.com | `X_API_BEARER_TOKEN`, `X_USERNAME`, `X_PASSWORD` |
| Database | `DATABASE_URL`, `REDIS_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| pump.fun | `PUMPFUN_PROGRAM_ID` |
| Config | `TREND_SCORE_THRESHOLD`, `INITIAL_BUY_SOL`, `MAX_DAILY_LAUNCHES`, etc. |

## Database

5 tables managed by Drizzle ORM:

| Table | Purpose |
|-------|---------|
| `trends` | Detected trends with AI scores and status |
| `tokens` | Launched tokens — mint address, bonding progress, status |
| `trades` | Buy/sell records with exit stage tracking |
| `wallets` | HD wallet pool — addresses, balances, cooldowns |
| `daily_pnl` | Daily P&L aggregation — launches, hit rate, net profit |

## License

MIT
