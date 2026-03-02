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

## Workflow (from CLAUDE.md global)
1. Write plan to `tasks/todo.md` first
2. Verify plan with user before implementing
3. Each change → commit → push (individually)
4. Track progress in todo.md as you go
5. Document results + capture lessons after corrections
