# Meme Coin Auto-Launcher — Implementation Tracker

## Phase 1 — Foundation ✅
- [x] `packages/shared` — config, DB schema, Redis, logger
- [x] `docker-compose.yml` — PostgreSQL + Redis
- [x] DB migration (drizzle)

## Phase 2 — Token Launcher ✅
- [x] `wallet-pool.ts` — HD Wallet pool
- [x] `deployer.ts` + `bundler.ts` — pump.fun deploy + Jito bundle
- [x] `metadata.ts` + `image-gen.ts` — AI metadata + image gen

## Phase 3 — Exit Manager ✅
- [x] `constants.ts` — Exit thresholds, PumpPortal/Jupiter URLs, Raydium IDs, Redis channels
- [x] `retry.ts` — Exponential backoff with jitter
- [x] `monitor.ts` — Bonding curve PDA fetch + batch via getMultipleAccountsInfo
- [x] `pnl.ts` — Token P&L calculation + daily_pnl aggregation upsert
- [x] `seller.ts` — PumpPortal sell API + HD wallet keypair derivation
- [x] `raydium.ts` — Migration detection (complete flag) + Jupiter sell
- [x] `exit-engine.ts` — 3-stage exit evaluation (pure fn) + runMonitorTick orchestrator
- [x] `index.ts` — Main loop: Redis sub, 5s polling, daily P&L, graceful shutdown

## Phase 4 — Trend Detection ✅
- [x] Package scaffold — package.json, tsconfig.json, constants.ts, retry.ts
- [x] `scraper.ts` — X API v2 Recent Search with keyword extraction
- [x] `scorer.ts` — Claude AI meme-coin viability scoring (0.0–1.0)
- [x] `filter.ts` — Duplicate check (DB 24h) + timing filter (>1h = skip)
- [x] `publisher.ts` — BullMQ queue producer for launch signals
- [x] `index.ts` — Main polling loop (30–60s random interval, graceful shutdown)

## Phase 5 — Telegram & Polish
- [ ] `telegram-bot` — alerts + commands (/status, /pnl, /tokens, /pause, /resume)
- [ ] 전체 파이프라인 통합 테스트
- [ ] Devnet 테스트 → Mainnet 배포
