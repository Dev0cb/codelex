# Sprint 2026-10-02 — Close Phase 0

**Goal:** close Phase 0 with a monorepo where any agent can scaffold, test and merge a pure TypeScript package
safely in under 10 minutes.

**Status:** Approved by the product owner on 2026-10-02 (lean scope). In progress.

## Scope decision (approved)
Phase 1 ("Playable core") runs offline: one player vs bots on device. It needs no Postgres, Redis, Kafka, MinIO
or wire protocol. Proposed:
- **Defer E-0.3** (docker compose local stack) to Phase 2 (with E-2.2 / E-2.9).
- **Split E-0.5**: keep a minimal `packages/observability` (logger + PII redaction) now; defer OTel exporters,
  collector and `packages/protocol` (with ADR-0011 on protocol/event versioning — a one-way door) to E-2.3.
- **Trim E-0.4**: coverage gates + secret scan + SAST now; bundle budgets with the first app (Phase 1); mutation,
  k6, chaos later.
Phase 0 exit criteria are unchanged (none depends on the deferred items).

## Success indicators
- `/scaffold` → green CI for a new package in < 10 min, measured on 2 trial packages.
- CI p50 for an affected-only change < 5 min; main green throughout the sprint.
- Coverage floors (90 % strict / 80 % base) enforced: a deliberately under-covered test package fails.

## Tasks

| ID | Task | Owner agent | Depends on | Acceptance criteria | Size | Status |
|---|---|---|---|---|---|---|
| S1 | ADR-0012 lint/format toolchain (ESLint flat + boundaries + Prettier vs Biome) and design note: `Result<T,E>` shape, `packages/config` export map | solution-architect, devops-sre | — | ADR accepted by human; export map (`eslint`, `prettier`, `vitest`, `result`) documented; root `tsconfig.base.json` path kept (scaffold relies on it) | S | todo |
| S2 | `packages/config`: ESLint flat config with dependency-boundary rules, Prettier, Vitest presets (base 80 %, strict 90 %), fast-check, `Result` type | devops-sre | S1 | Tests first: Result unit + property tests; fixture packages that must fail boundary lint (service→service import, game-engine→IO) and coverage floor; `pnpm turbo run lint typecheck test --filter=@codelex/config` green, coverage ≥ 90 % | M | todo |
| S3 | Minimal `packages/observability`: pino logger with redaction (tokens, emails, receipts), no OTel exporter yet | devops-sre | S2 | Test proves redaction of token/email/receipt fields; strict preset coverage ≥ 80 %; README with owner and API | S | todo |
| S4 | CI hardening: gitleaks (full history on main, diff on PR) + CodeQL JS/TS, coverage enforced via presets | devops-sre, security-engineer | — | Scans added as steps of existing required jobs or as non-required jobs (changing required checks = human admin action); a planted fake secret fails CI on a test branch | S | todo |
| S5 | Update `/scaffold` to wire `@codelex/config` + `@codelex/observability`; golden-path CI job scaffolds a throwaway package | devops-sre | S2, S3 | Timed CI job: scaffold + lint + typecheck + test green in < 10 min; skill text matches reality (`pnpm framework:validate` green) | M | todo |
| S6 | Roadmap update: move E-0.3 and deferred E-0.5 parts to Phase 2, mark E-0.2/E-0.4/E-0.5 status | solution-architect | human approval ✔ | `docs/roadmap/ROADMAP.md` reflects the approved scope; framework validator green | S | done |
| S7 | Phase 0 exit check | qa-engineer | S1–S6 | main green; `pnpm validate` passes; scaffold timing recorded in this file; Phase 0 marked done | S | todo |

### Phase 1 preparation (parallel, does not block engineers)

| ID | Task | Owner agent | Depends on | Acceptance criteria | Size | Status |
|---|---|---|---|---|---|---|
| P1 | `/feature-spec` "Classic match vs bot" (E-1.5 incl. Knowledge Card), with playtest KPIs and events | product-strategist, game-designer | — | Spec at `Ready for design`; Phase 1 exit KPIs mapped to analytics events | M | todo |
| P2 | Review `GAME_RULES.md` / `BALANCE.md` into a list of engine property tests and simulator targets (E-1.1, E-1.6) | game-designer | — | Every rule ID mapped to ≥ 1 testable property; open questions listed | S | todo |
| P3 | Design note for the `LexiconIndex` interface and GADDAG build (E-1.2) | lexicon-engineer | — | Interface signature, perf budget (< 5 µs lookup), versioning by `lexiconVersion`; reviewed by game-engine-engineer | S | todo |

## Deferred (recorded)
Local stack (E-0.3), `packages/protocol` + ADR-0011, OTel exporters/collector, bundle budgets, event registry,
Testcontainers harness, GraphQL schema checks, mutation/k6/chaos — each returns with the epic that first needs it.
