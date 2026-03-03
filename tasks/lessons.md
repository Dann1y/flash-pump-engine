# Lessons Learned

## Commit Discipline (Phase 3 correction)
**Rule**: `commit every single changes and push them into single pieces` (from CLAUDE.md)
**Mistake**: Phase 3 exit-manager was committed as 1 big commit (8 source files + package scaffold + todo update) instead of individual commits per logical change.
**Correct pattern**: Each step should be its own commit + push:
  1. `git add <files for step>` → `git commit` → `git push` — one at a time
  2. Example: package scaffold is one commit, constants+retry is another, monitor.ts is another, etc.
  3. Never batch multiple logical changes into a single commit

## Monorepo .env Loading (Integration Test)
**Problem**: `dotenv/config` loads `.env` from CWD. When using `pnpm --filter`, CWD is the package directory, not monorepo root — all env vars fail validation.
**Fix**: Use `dotenv.config({ path: path.resolve(__dirname, "../../../.env") })` in shared config.ts to always resolve from monorepo root.
**Rule**: In monorepos, always use explicit path resolution for env files, never rely on CWD.

## Python Version Compatibility (Integration Test)
**Problem**: `dict | None` union syntax requires Python 3.10+, but macOS ships Python 3.9.6.
**Fix**: Add `from __future__ import annotations` at top of Python files that use modern type hints.
**Rule**: Always add `from __future__ import annotations` in Python scripts that may run on 3.9.

## PumpPortal Token2022 Migration (Mainnet Test 2026-03-03)
**Problem**: pump.fun migrated to Token2022 (program: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). PumpPortal `create` action with `amount > 0` returns `Cannot read properties of undefined (reading 'toBuffer')`.
**Fix**: Split into bundle array `[create(amount=0), buy(amount)]` sent as JSON to `/api/trade-local`. Response is JSON array of bs58-encoded unsigned VersionedTransactions.
**Rule**: Always use bundle array format `[create(0), buy(amount)]` — never set amount>0 on create.

## Jito Bundle Tips & Retry Strategy (Mainnet Test 2026-03-03)
**Problem**: Low tips (0.001 SOL) cause "Failed to land". Reusing signed txs causes "expired blockhash".
**Fix**:
- Tip range: 0.005–0.01 SOL (via PumpPortal `priorityFee` on first tx)
- Retry at caller level: call PumpPortal again for fresh txs (new blockhash) each attempt
- Jito endpoints: try all 4 (mainnet, amsterdam, frankfurt, ny) sequentially
**Rule**: Never retry with stale transactions. Always get fresh txs from PumpPortal per attempt.

## Token2022 ATA Derivation (Mainnet Test 2026-03-03)
**Problem**: Token2022 ATAs use different program ID than legacy Token program.
**Fix**: Try both `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token2022) and `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (legacy) for ATA derivation.
**Rule**: Always check both Token programs when querying token balances for pump.fun tokens.

## Exit-Manager DRY_RUN Token Cleanup
**Problem**: Old DRY_RUN tokens (with `dry-run-*` deploy_tx) have no on-chain bonding curves. Exit-manager triggers emergency sell → PumpPortal returns 400 → infinite retry loop.
**Fix**: Added `consecutiveFailures` counter — after 3 failures, mark token as `failed` and stop retrying.
**Rule**: Always clean up DRY_RUN test records before running exit-manager in production mode.

## Workflow (from CLAUDE.md global)
1. Write plan to `tasks/todo.md` first
2. Verify plan with user before implementing
3. Each change → commit → push (individually)
4. Track progress in todo.md as you go
5. Document results + capture lessons after corrections
