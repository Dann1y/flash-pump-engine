# Lessons Learned

## Commit Discipline (Phase 3 correction)
**Rule**: `commit every single changes and push them into single pieces` (from CLAUDE.md)
**Mistake**: Phase 3 exit-manager was committed as 1 big commit (8 source files + package scaffold + todo update) instead of individual commits per logical change.
**Correct pattern**: Each step should be its own commit + push:
  1. `git add <files for step>` → `git commit` → `git push` — one at a time
  2. Example: package scaffold is one commit, constants+retry is another, monitor.ts is another, etc.
  3. Never batch multiple logical changes into a single commit

## Workflow (from CLAUDE.md global)
1. Write plan to `tasks/todo.md` first
2. Verify plan with user before implementing
3. Each change → commit → push (individually)
4. Track progress in todo.md as you go
5. Document results + capture lessons after corrections
