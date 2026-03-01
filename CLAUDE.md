# 🚀 Project: Meme Coin Auto-Launcher

## Mission

X.com(Twitter)에서 실시간 트렌드를 감지하고, 밈코인화 가능성이 높은 트렌드를 AI로 스코어링한 뒤, pump.fun에 토큰을 자동 발행하고, 분할 매도로 수익을 실현하는 **End-to-End 자동화 파이프라인**을 구축한다.

---

## Tech Stack (확정)

- **Runtime**: TypeScript (Node.js 20+) — 메인, Python 3.11+ — X 스크래핑 보조
- **Blockchain**: @solana/web3.js, @solana/spl-token, jito-ts (bundle SDK)
- **AI/LLM**: Anthropic Claude API (Sonnet) — 트렌드 스코어링 & 토큰 메타 생성
- **Image Gen**: OpenAI DALL-E 3 API 또는 Replicate Flux — 토큰 프로필 이미지
- **DB**: PostgreSQL 16 (Drizzle ORM) + Redis 7 (ioredis + BullMQ)
- **RPC**: Helius (Solana RPC + WebSocket)
- **Alerting**: Telegram Bot API (grammy)
- **Infra**: Docker Compose, pnpm workspace (monorepo)
- **Config**: dotenv + zod schema validation

---

## Project Structure

```
meme-launcher/
├── docker-compose.yml
├── .env.example
├── package.json                  # pnpm workspace root
├── tsconfig.base.json
│
├── packages/
│   ├── shared/                   # 공유 타입, 유틸, DB 스키마
│   │   ├── src/
│   │   │   ├── types.ts          # 전체 프로젝트 공유 타입 정의
│   │   │   ├── config.ts         # env 로딩 + zod validation
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # Drizzle ORM 스키마 (trends, tokens, trades, wallets)
│   │   │   │   ├── client.ts     # DB 연결 싱글톤
│   │   │   │   └── migrate.ts    # 마이그레이션 러너
│   │   │   ├── redis.ts          # Redis 연결 + pub/sub 헬퍼
│   │   │   └── logger.ts         # pino 로거 (structured JSON logging)
│   │   └── package.json
│   │
│   ├── trend-detector/           # Module 1: X.com 트렌드 감지
│   │   ├── src/
│   │   │   ├── index.ts          # 메인 루프 (polling interval)
│   │   │   ├── scraper.ts        # X.com 데이터 수집 (API v2 또는 스크래핑)
│   │   │   ├── scorer.ts         # Claude API로 밈코인화 가능성 스코어링
│   │   │   ├── filter.ts         # 중복 필터 (이미 발행된 토큰명 체크) + 타이밍 필터
│   │   │   └── publisher.ts      # 스코어 통과 시그널을 Redis Queue에 발행
│   │   └── package.json
│   │
│   ├── token-launcher/           # Module 2: 토큰 자동 발행
│   │   ├── src/
│   │   │   ├── index.ts          # BullMQ Worker — 큐에서 시그널 소비
│   │   │   ├── metadata.ts       # Claude API로 토큰 이름/티커/설명 생성
│   │   │   ├── image-gen.ts      # DALL-E 3 / Flux로 프로필 이미지 생성
│   │   │   ├── deployer.ts       # pump.fun 온체인 배포 (본딩 커브 생성)
│   │   │   ├── bundler.ts        # Jito bundle: 토큰 생성 + 초기 매수를 원자적 실행
│   │   │   └── wallet-pool.ts    # HD Wallet 풀 관리 (생성, 로테이션, SOL 분배/회수)
│   │   └── package.json
│   │
│   ├── exit-manager/             # Module 3: 포지션 관리 & 수익 실현
│   │   ├── src/
│   │   │   ├── index.ts          # 메인 루프 — 활성 포지션 모니터링
│   │   │   ├── monitor.ts        # 본딩 커브 진행률, 거래량, 홀더 수 실시간 추적
│   │   │   ├── exit-engine.ts    # 3단계 분할 매도 로직 (원금회수 → 50% → 잔여)
│   │   │   ├── raydium.ts        # Raydium 마이그레이션 감지 + 마이그 후 매도
│   │   │   └── pnl.ts            # 토큰별/일별/월별 P&L 계산 및 DB 저장
│   │   └── package.json
│   │
│   └── telegram-bot/             # 알림 & 대시보드
│       ├── src/
│       │   ├── index.ts          # Bot 초기화 + 커맨드 핸들러
│       │   ├── alerts.ts         # 이벤트 구독 → 텔레그램 메시지 발송
│       │   └── commands.ts       # /status, /pnl, /pause, /resume 등 커맨드
│       └── package.json
│
├── scripts/
│   ├── setup-wallets.ts          # 초기 HD Wallet 풀 생성 스크립트
│   ├── fund-wallets.ts           # 메인 지갑에서 서브 지갑으로 SOL 분배
│   └── collect-funds.ts          # 서브 지갑에서 메인 지갑으로 SOL 회수
│
└── python/
    └── x-scraper/                # X.com 스크래핑 보조 (Playwright 기반)
        ├── scraper.py            # 로그인 + 트렌딩/검색 결과 스크래핑
        ├── requirements.txt
        └── Dockerfile
```

---

## Database Schema (Drizzle ORM)

```typescript
// packages/shared/src/db/schema.ts

// 1. trends — 감지된 트렌드 기록
trends {
  id: serial primary key
  keyword: varchar(200) not null           // 트렌드 키워드/문구
  score: real not null                     // AI 스코어 (0.0 ~ 1.0)
  context: jsonb                           // 원본 트윗 샘플, 멘션 수, 이미지 URL 등
  source: varchar(50) default 'x.com'      // 데이터 소스
  status: enum('detected', 'launched', 'skipped', 'expired')
  detected_at: timestamp default now()
  created_at: timestamp default now()
}

// 2. tokens — 발행된 토큰 기록
tokens {
  id: serial primary key
  trend_id: integer references trends(id)
  mint_address: varchar(64) unique not null  // Solana 민트 주소
  name: varchar(100) not null
  ticker: varchar(20) not null
  description: text
  image_url: text                            // 생성된 프로필 이미지 URL
  deploy_wallet: varchar(64) not null        // 발행에 사용된 지갑
  deploy_tx: varchar(128)                    // 배포 트랜잭션 시그니처
  initial_buy_sol: real                      // 초기 매수 SOL 금액
  initial_buy_tokens: bigint                 // 초기 매수 토큰 수량
  status: enum('deploying', 'active', 'exiting', 'completed', 'failed')
  bonding_progress: real default 0           // 본딩 커브 진행률 (0~100%)
  raydium_migrated: boolean default false
  launched_at: timestamp default now()
  created_at: timestamp default now()
}

// 3. trades — 매수/매도 기록
trades {
  id: serial primary key
  token_id: integer references tokens(id)
  type: enum('buy', 'sell')
  sol_amount: real not null
  token_amount: bigint not null
  price_per_token: real
  wallet: varchar(64) not null
  tx_signature: varchar(128) unique
  exit_stage: integer                       // 매도 단계 (1, 2, 3)
  executed_at: timestamp default now()
}

// 4. wallets — 지갑 풀 관리
wallets {
  id: serial primary key
  address: varchar(64) unique not null
  derivation_path: varchar(50)              // HD wallet path
  sol_balance: real default 0
  is_active: boolean default true
  last_used_at: timestamp
  created_at: timestamp default now()
}

// 5. daily_pnl — 일별 손익 집계
daily_pnl {
  id: serial primary key
  date: date unique not null
  tokens_launched: integer default 0
  tokens_hit: integer default 0             // 본딩 50%+ 도달
  tokens_raydium: integer default 0         // Raydium 마이그레이션 도달
  total_cost_sol: real default 0            // 발행비 + 초기매수 총액
  total_revenue_sol: real default 0         // 매도 수익 총액
  net_pnl_sol: real default 0
  hit_rate: real default 0                  // tokens_hit / tokens_launched
}
```

---

## Module 1: Trend Detection Engine (trend-detector)

### 핵심 로직

**scraper.ts** — X.com 데이터 수집:

- X API v2 사용 가능하면 Recent Search endpoint로 크립토 관련 급상승 키워드 수집
- API 불가 시 Python x-scraper 프로세스를 child_process로 실행하여 Playwright 기반 스크래핑
- 수집 대상: 트렌딩 토픽, 크립토 CT(Crypto Twitter) 인플루언서 피드, 급상승 해시태그
- 30초~1분 간격 polling

**scorer.ts** — AI 밈코인화 가능성 스코어링:

- Claude API (claude-sonnet-4-20250514) 호출
- 프롬프트 설계:

```
당신은 크립토 밈코인 트렌드 분석가입니다.
다음 트렌드/키워드의 pump.fun 밈코인화 가능성을 0.0~1.0으로 스코어링하세요.

평가 기준:
1. 바이럴 잠재력 (밈화 가능성, 유머/감정 호소)
2. 크립토 커뮤니티 관련성 (CT에서 이미 언급되는지)
3. 토큰 네이밍 적합성 (짧고 캐치한 이름으로 변환 가능한지)
4. 타이밍 (아직 초기인지, 이미 식은 트렌드인지)
5. 이미지/밈 동반 여부 (비주얼 요소가 있으면 토큰 이미지 제작 용이)

트렌드: "{keyword}"
컨텍스트: {context_json}

JSON으로 응답:
{"score": 0.0~1.0, "reasoning": "한줄 이유", "suggested_name": "토큰명 제안", "suggested_ticker": "티커 제안"}
```

- score ≥ 0.7이면 시그널로 판정

**filter.ts** — 중복 & 타이밍 필터:

- DB에서 최근 24시간 내 동일/유사 키워드로 발행된 토큰 조회 → 중복이면 스킵
- pump.fun API로 현재 활성 토큰 중 동일 이름 존재 여부 확인
- 트렌드 감지 시점에서 이미 1시간 이상 지난 트렌드는 스킵 (late entry 방지)

**publisher.ts** — 시그널 발행:

- 필터 통과한 시그널을 BullMQ 큐 `token-launch-queue`에 추가
- 시그널 페이로드: `{ keyword, score, reasoning, suggested_name, suggested_ticker, context, image_urls }`

---

## Module 2: Token Launch Automation (token-launcher)

### 핵심 로직

**metadata.ts** — 토큰 메타데이터 생성:

- Claude API로 최종 토큰 이름, 티커, 설명문 생성
- 프롬프트:

```
pump.fun에 올릴 밈코인의 메타데이터를 생성하세요.

트렌드: "{keyword}"
컨텍스트: {context}

요구사항:
- name: 캐치하고 밈적인 이름 (영문, 2~3단어 이내)
- ticker: 3~6자 대문자 (기억하기 쉽게)
- description: 펌프펀 스타일의 유머러스한 설명 (영문 2~3문장, 이모지 포함)

JSON으로 응답: {"name": "", "ticker": "", "description": ""}
```

**image-gen.ts** — 프로필 이미지 생성:

- DALL-E 3 API 또는 Replicate Flux 호출
- 프롬프트: 트렌드 키워드 기반 밈 스타일 이미지 (512x512, 밝고 eye-catching)
- 생성된 이미지를 IPFS 또는 임시 호스팅에 업로드 (pump.fun 메타데이터용)

**wallet-pool.ts** — 지갑 풀 관리:

- BIP-44 기반 HD Wallet에서 서브 키페어 파생
- 풀 사이즈: 최소 20개 지갑, 각 지갑에 0.1~0.5 SOL 유지
- 로테이션: 한 지갑으로 연속 발행 금지, 최소 1시간 쿨다운
- SOL 잔액 부족 시 메인 지갑에서 자동 보충

**deployer.ts** — pump.fun 온체인 배포:

- pump.fun 프로그램 ID를 통해 본딩 커브 토큰 생성 트랜잭션 구성
- 필요한 계정: 민트 키페어(신규 생성), 본딩 커브 PDA, 메타데이터 PDA
- 메타데이터(name, symbol, uri)를 포함한 `create` instruction 생성

**bundler.ts** — Jito Bundle (발행 + 초기 매수 원자적 실행):

- 트랜잭션 1: 토큰 생성 (create)
- 트랜잭션 2: 초기 매수 (buy) — 0.05~0.2 SOL 규모
- 두 트랜잭션을 Jito bundle로 묶어서 원자적 실행
- 번들 팁: 0.001~0.005 SOL (상황에 따라 동적 조정)
- 실패 시 최대 3회 재시도

---

## Module 3: Position & Exit Manager (exit-manager)

### 핵심 로직

**monitor.ts** — 실시간 포지션 모니터링:

- DB에서 status='active'인 모든 토큰 조회
- Helius WebSocket으로 각 토큰의 본딩 커브 계정 변동 구독
- 5초 간격으로 다음 데이터 갱신:
  - 본딩 커브 진행률 (현재 시총 / $69K 목표)
  - 최근 5분 거래량
  - 홀더 수 변화
  - 가격 변동률

**exit-engine.ts** — 3단계 분할 매도:

```
Exit Stage 1 (원금 회수):
  조건: 본딩 커브 40~50% 도달 OR 보유 토큰 가치 ≥ 초기 투입 SOL × 3
  행동: 초기 투입 SOL만큼 매도 (원금 회수)

Exit Stage 2 (수익 실현):
  조건: 본딩 커브 70%+ 도달 OR Raydium 마이그레이션 임박
  행동: 남은 보유량의 50% 매도

Exit Stage 3 (잔여 청산):
  조건: Raydium 마이그레이션 후 거래량 피크 OR 가격 고점 대비 -30% (trailing stop)
  행동: 나머지 전량 매도

Emergency Exit:
  조건: 가격이 초기 매수가 대비 -50% OR 12시간 이상 거래량 0
  행동: 전량 즉시 매도 (손절)
```

**raydium.ts** — Raydium 마이그레이션 감지:

- 본딩 커브가 $69K 도달하면 pump.fun이 자동으로 Raydium AMM 풀 생성
- 마이그레이션 이벤트를 WebSocket으로 감지
- 마이그레이션 후 Raydium 풀에서 매도 실행 (다른 프로그램 ID, 다른 instruction)

**pnl.ts** — 손익 계산:

- 토큰별: (총 매도 SOL - 총 매수 SOL - 발행 수수료) = 순이익
- 일별 집계: daily_pnl 테이블에 자동 저장
- 히트율 계산: (본딩 50%+ 토큰 수 / 발행 토큰 수)

---

## Module 4: Telegram Bot (telegram-bot)

### 커맨드

- `/status` — 시스템 상태 (활성 토큰 수, 큐 대기 수, 지갑 잔액)
- `/pnl` — 오늘/이번 주/이번 달 P&L 요약
- `/tokens` — 최근 발행 토큰 목록 + 상태
- `/pause` — 신규 발행 일시 중지 (기존 포지션 Exit은 계속)
- `/resume` — 발행 재개
- `/config` — 현재 설정값 조회/변경 (score threshold, exit 비율 등)

### 자동 알림

- 🟢 **발행 알림**: 새 토큰 발행 시 (이름, 티커, pump.fun 링크, 초기 매수 금액)
- 🔵 **히트 알림**: 본딩 커브 50%+ 도달 시
- 🟡 **마이그레이션 알림**: Raydium 도달 시
- 💰 **Exit 알림**: 각 매도 단계 실행 시 (수량, SOL 금액, 수익률)
- 🔴 **에러 알림**: 트랜잭션 실패, RPC 에러, 잔액 부족 등
- 📊 **일일 리포트**: 매일 자정 KST — 발행 수, 히트율, 순수익, 누적 수익

---

## Environment Variables (.env.example)

```env
# Solana
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_API_KEY=your_helius_key

# Wallet
MASTER_WALLET_PRIVATE_KEY=base58_encoded_private_key
HD_WALLET_MNEMONIC=your_12_or_24_word_mnemonic

# AI
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# X.com (Twitter)
X_API_BEARER_TOKEN=your_bearer_token
# fallback scraping (optional)
X_USERNAME=your_username
X_PASSWORD=your_password

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/meme_launcher
REDIS_URL=redis://localhost:6379

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# pump.fun
PUMPFUN_PROGRAM_ID=6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P

# Config
TREND_SCORE_THRESHOLD=0.7
INITIAL_BUY_SOL=0.1
MAX_DAILY_LAUNCHES=20
EXIT_STAGE1_MULTIPLIER=3
EXIT_STAGE2_BONDING_PCT=70
EXIT_TRAILING_STOP_PCT=30
WALLET_POOL_SIZE=20
WALLET_COOLDOWN_MINUTES=60
```

---

## Docker Compose

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: meme_launcher
      POSTGRES_USER: launcher
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  trend-detector:
    build:
      context: .
      dockerfile: packages/trend-detector/Dockerfile
    depends_on: [postgres, redis]
    env_file: .env
    restart: unless-stopped

  token-launcher:
    build:
      context: .
      dockerfile: packages/token-launcher/Dockerfile
    depends_on: [postgres, redis]
    env_file: .env
    restart: unless-stopped

  exit-manager:
    build:
      context: .
      dockerfile: packages/exit-manager/Dockerfile
    depends_on: [postgres, redis]
    env_file: .env
    restart: unless-stopped

  telegram-bot:
    build:
      context: .
      dockerfile: packages/telegram-bot/Dockerfile
    depends_on: [postgres, redis]
    env_file: .env
    restart: unless-stopped

  x-scraper:
    build:
      context: python/x-scraper
    depends_on: [redis]
    env_file: .env
    restart: unless-stopped

volumes:
  pgdata:
```

---

## Implementation Order

### Phase 1 — Foundation (이것부터)

1. `packages/shared` — config, DB 스키마, Redis 연결, 로거 세팅
2. `docker-compose.yml` — PostgreSQL + Redis 컨테이너 가동
3. DB 마이그레이션 실행

### Phase 2 — Token Launcher (돈이 나오는 곳부터)

4. `wallet-pool.ts` — HD Wallet 풀 생성 및 관리
5. `deployer.ts` + `bundler.ts` — pump.fun 토큰 생성 + 초기 매수 (수동 테스트)
6. `metadata.ts` + `image-gen.ts` — 메타데이터 자동 생성

### Phase 3 — Exit Manager (수익 실현)

7. `monitor.ts` — 실시간 포지션 모니터링
8. `exit-engine.ts` — 분할 매도 로직
9. `raydium.ts` — 마이그레이션 감지

### Phase 4 — Trend Detection (자동화)

10. `scraper.ts` — X.com 데이터 수집
11. `scorer.ts` — AI 스코어링
12. `filter.ts` + `publisher.ts` — 필터링 및 큐 발행

### Phase 5 — Telegram & Polish

13. `telegram-bot` — 알림 + 커맨드
14. 전체 파이프라인 통합 테스트
15. Devnet 테스트 → Mainnet 배포

---

## Critical Implementation Notes

### pump.fun 온체인 상호작용

- pump.fun은 Solana 프로그램으로, 공식 SDK가 없다. 온체인 instruction을 직접 구성해야 한다.
- 최신 pump.fun 프로그램 IDL과 instruction 포맷은 GitHub/Solscan에서 리버스 엔지니어링하거나, 기존 오픈소스 봇 코드를 참조한다.
- `create` instruction: 민트 키페어 + 메타데이터(name, symbol, uri) + 본딩 커브 PDA
- `buy` instruction: 민트 주소 + SOL 금액 + 슬리피지
- `sell` instruction: 민트 주소 + 토큰 수량 + 최소 SOL 수령량

### Jito Bundle 주의사항

- 번들 내 트랜잭션은 순서가 보장된다 (tx1: create → tx2: buy)
- 번들 팁은 별도 트랜잭션으로 포함하거나 마지막 tx에 팁 instruction 추가
- jito-ts 또는 Jito Block Engine JSON-RPC API 사용
- 번들 실패 시 전체 롤백되므로 부분 실행 위험 없음

### Anti-Detection 전략

- 절대 같은 지갑으로 연속 발행하지 않는다
- 초기 매수 금액을 0.05~0.2 SOL 범위에서 랜덤화
- 발행 간격을 3~10분으로 랜덤화 (일정한 패턴 방지)
- 지갑 간 SOL 이동은 메인 지갑 ↔ 서브 지갑으로만, 서브 간 직접 이동 금지

### Rate Limit & Error Handling

- Claude API: 분당 요청 수 제한 주의, 429 시 exponential backoff
- Helius RPC: 초당 요청 수 제한, 전용 플랜 권장
- Solana 트랜잭션: blockhash 만료 (약 60초), 실패 시 새 blockhash로 재시도
- 모든 외부 API 호출에 retry 로직 (최대 3회, exponential backoff)

### Devnet 테스트

- 먼저 Solana Devnet에서 전체 파이프라인 테스트
- pump.fun이 Devnet에 없으면 로컬에서 mock 프로그램 사용하거나 Mainnet에서 소규모 테스트
- 지갑 풀, 번들링, Exit 로직은 Devnet에서 충분히 검증 후 Mainnet 전환
