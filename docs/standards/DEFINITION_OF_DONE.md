# Definition of Done

A change is **done** only when every applicable item is true. `/implement` checks this list explicitly.

## Always
- [ ] Acceptance criteria of the task/spec are met and each has at least one automated test.
- [ ] `pnpm turbo run lint typecheck test --filter=...[origin/main]` passes; `pnpm validate` passes.
- [ ] Coverage floors respected (90% game-engine/protocol, 80% elsewhere) — no lowered thresholds.
- [ ] `/review` run; no open Blocker/Major findings.
- [ ] Docs updated (package README, specs, ADR, runbook) in the same PR.
- [ ] Conventional Commit messages; PR template completed.

## If user-visible
- [ ] Behind a feature flag with a documented rollout plan and kill switch.
- [ ] Strings in `packages/i18n` (EN + FR); layout checked with FR and large text.
- [ ] Accessibility: labels, contrast, reduced motion, screen reader path verified.
- [ ] Analytics events implemented and documented in `docs/standards/ANALYTICS_EVENTS.md`.
- [ ] Empty, loading, error and offline states implemented.

## If server-side
- [ ] Inputs validated (zod), authz enforced, rate limits set.
- [ ] Traces, metrics and logs present; alerts + runbook for new failure modes.
- [ ] Migrations backward compatible; rollback plan written.
- [ ] Load/perf budget verified for hot paths.

## If gameplay/balance
- [ ] Rules documented in `docs/game/GAME_RULES.md` with rule IDs referenced by tests.
- [ ] `/balance-check` passed for outcome-affecting changes.
- [ ] Determinism: golden replays updated intentionally (diff reviewed) or unchanged.

## If personal data, minors, payments, UGC
- [ ] `privacy-compliance` review done; `docs/compliance/DATA_MAP.md` updated.
- [ ] `security-engineer` threat model mitigations implemented.
