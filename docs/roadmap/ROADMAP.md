# CODELEX — Roadmap

Owner: `product-strategist` (scope) & `solution-architect` (sequencing). Phases are gated by **exit criteria**,
not dates. `/sprint-plan` reads this file to pick the next epic. Epic IDs are stable (`E-x.y`); vision references
in brackets.

Legend: ☐ not started · ◐ in progress · ☑ done

---

## Phase 0 — Foundations (engineering platform) ☑
Goal: a monorepo where agents can ship safely. Closed 2026-10-02 (exit check: sprint
`docs/sprints/2026-10-02-phase0-close.md`, S7).

| ID | Epic | Owner | Status |
|---|---|---|---|
| E-0.1 | Agentic framework (agents, skills, hooks, validators, CI) | solution-architect | ☑ |
| E-0.2 | Monorepo tooling: pnpm, Turborepo, `packages/config` (tsconfig/eslint/prettier, Vitest presets, `Result`) | devops-sre | ☑ |
| E-0.4 | CI pipeline (validators, lint, typecheck, test affected, coverage floors, secret scan, SAST) | devops-sre | ☑ |
| E-0.5 | Minimal `packages/observability` (logger + PII redaction) | devops-sre | ☑ |
| E-0.6 | Lexicon schema v1 + validator + seed (≥ 300 terms, 9 categories) [V-04, V-05] | lexicon-engineer, lexicon-curator | ☑ |

Exit criteria: CI green on main; `pnpm validate` passes; a new package can be scaffolded with `/scaffold` and is
green in < 10 min; lexicon seed validated.

Re-scoped 2026-10-02 (sprint `docs/sprints/2026-10-02-phase0-close.md`, approved by the product owner): Phase 1
runs offline, so the local stack, `packages/protocol` (+ ADR on protocol/event versioning) and OpenTelemetry
exporters moved to Phase 2 (E-2.0, E-2.3, E-2.9). Bundle budgets arrive with the first app in Phase 1.

## Phase 1 — Playable core (single player vs bots, offline-capable)
Goal: prove the fun.
In progress since 2026-10-02 — sprint 1 `docs/sprints/2026-10-02-phase1-engine-core.md` done (exit check 2026-10-03);
sprint 2 `docs/sprints/2026-10-03-phase1-bots-app-foundation.md` closed (exit check 2026-10-04; H1 device timings and
stretch S1 carried over); sprint 3 not yet planned.

| ID | Epic | Owner |
|---|---|---|
| E-1.1 | `packages/game-engine`: board, bag, placement, validation, scoring, Classic rules [V-03, V-07] | game-engine-engineer |
| E-1.2 | Lexicon index build (GADDAG) + `LexiconIndex` interface | lexicon-engineer |
| E-1.3 | `packages/bots`: Beginner + Strategist; simulator CLI [V-15] | ai-engineer |
| E-1.4 | Design system v1 + board renderer (Skia) + game feel [V-02, V-03] | ux-ui-designer, mobile-engineer |
| E-1.5 | Mobile app: home, play vs bot, end-of-match, Knowledge Card (local data) [V-13] | mobile-engineer |
| E-1.6 | Balance baseline: tile distribution & scoring calibrated by simulation | game-designer |
| E-1.7 | Playtest lexicon: ≥ 2,000 playable forms (≥ 30 two-letter), inflected forms (plurals) supported [V-04] | lexicon-curator, lexicon-engineer |

Exit: internal playtest (≥ 30 players) — median session ≥ 8 min, "would play again" ≥ 70%, first-player win
rate ≤ 52% in simulation, crash-free ≥ 99.5%.

## Phase 2 — Online & competitive MVP (soft launch)
| ID | Epic | Owner |
|---|---|---|
| E-2.0 | Local stack: docker compose (Postgres, Redis, Redpanda, MinIO, OTel collector), images pinned by digest | devops-sre |
| E-2.1 | Identity: guest → account, Sign in with Apple/Google, deletion, age gate | backend-engineer |
| E-2.2 | `services/game` server authority + event-sourced match log | game-engine-engineer |
| E-2.3 | `services/realtime` WebSocket edge + `packages/protocol` v1 (ADR on protocol/event versioning first) | realtime-engineer |
| E-2.4 | Matchmaking 1v1 + Glicko-2 ranked (Classic, Blitz 60 s) [V-07] | realtime-engineer |
| E-2.5 | Progression v1: XP, level, technology profile [V-06] | backend-engineer |
| E-2.6 | Daily CODELEX + global daily leaderboard [V-16] | backend-engineer, game-designer |
| E-2.7 | Integrity v1: server validation, timing anomalies, multi-account signals [V-25] | security-engineer |
| E-2.8 | Analytics pipeline + core dashboards | data-analyst |
| E-2.9 | Production infra single region + SLOs + runbooks + OpenTelemetry exporters/collector | devops-sre |
| E-2.10 | Store compliance & soft launch in 2–3 countries (incl. Senegal, France) | privacy-compliance, mobile-engineer |

Exit: D1 ≥ 40%, D7 ≥ 15%, ranked queue p95 < 30 s at soft-launch population, SLOs met 4 weeks, no S1 open.

## Phase 3 — Depth & retention
E-3.1 Arena mode + HP/damage [V-07] · E-3.2 Tech Powers with kill switches [V-08] · E-3.3 Missions &
achievements [V-17, V-18] · E-3.4 Knowledge Graph service + graph explorer + chains [V-13, V-14] · E-3.5 Bots
Speedster/Architect/Grandmaster [V-15] · E-3.6 Social: friends, challenges, replays, share cards [V-19] ·
E-3.7 Clans [V-12] · E-3.8 Season system + Season 01 THE CLOUD [V-09].

Exit: D30 ≥ 8%, ≥ 25% of WAU open a Knowledge Card weekly, power usage→win lift ≤ 5 pts.

## Phase 4 — Monetisation & global launch
E-4.1 Cosmetics store & personalisation [V-20, V-26] · E-4.2 CODELEX+ subscription · E-4.3 CODELEX Coach (Claude)
[V-15] · E-4.4 Multi-region realtime + CDN + DR drills [V-24] · E-4.5 CODELEX World leaderboards (countries,
universities, communities) [V-10] · E-4.6 Localisation beyond EN/FR · E-4.7 Advanced anti-cheat (engine
correlation, collusion graphs) [V-25].

Exit: global launch; payer conversion ≥ 2%; 99.95% availability over a season; cheating report rate trending down.

## Phase 5 — Esports & B2B/EDU
E-5.1 Tournaments platform (brackets, qualifiers → world championship, spectating delay) [V-11] · E-5.2 Org
spaces + restricted dictionaries [V-22, V-23] · E-5.3 Teacher dashboard & enterprise analytics · E-5.4 SSO,
invoicing, licences · E-5.5 Sponsored tournaments framework.

## Phase 6 — Academy & ecosystem
E-6.1 CODELEX Academy tracks [V-21] · E-6.2 Recommendation engine · E-6.3 Public knowledge pages (SEO) ·
E-6.4 Partner/API program.
