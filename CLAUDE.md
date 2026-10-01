# CODELEX — Project Constitution

> **Play the language of technology.**
> CODELEX is a competitive gaming platform built around the language, concepts and culture of technology.
> The letter game is the front door. The product is the ecosystem:
> Game + Competition + Knowledge Graph + Community + AI + Education + Esports + Enterprise.

This file is loaded into every Claude Code session. It is the single source of truth for **how work is done** in this
repository. Product truth lives in `docs/vision/PRODUCT_VISION.md`; technical truth lives in
`docs/architecture/ARCHITECTURE.md` and `docs/adr/`.

---

## 1. Non-negotiable principles

1. **Server-authoritative competition.** Every ranked, tournament, Arena or Daily result is computed on the server.
   The client predicts and renders; it never decides a score, a word's validity, a timer or a power's effect.
2. **One rules engine.** Game rules live in `packages/game-engine` — pure, deterministic, side-effect-free TypeScript,
   seeded RNG only. Client and server import the same code. Never duplicate rule logic anywhere else.
3. **The Lexicon is data, not code.** Terms, categories, relations and values live in `packages/lexicon/data`, validated
   by `packages/lexicon/schema`. Changes go through the `lexicon-curator` agent and the `/lexicon-add` skill.
4. **No pay-to-win.** Nothing purchasable may change win probability. Money buys cosmetics, convenience outside
   competition, analytics, private spaces (B2B/EDU). Any doubt → `game-designer` + `monetization-liveops` review.
5. **Fun first, learning embedded.** The player must see a competitive game, never a course. Knowledge surfaces
   *after* play (Knowledge Cards, graph, coach), never as a gate before play.
6. **Mobile-first, global-first.** Design for a mid-range Android phone on a 3G link in Dakar before a flagship on fiber
   in San Francisco. i18n (EN/FR at launch) and RTL-readiness from day one; no hard-coded user-facing strings.
7. **Privacy and minors by design.** GDPR, CCPA, COPPA/age-gating, App Store & Play policies are requirements, not
   afterthoughts. Collect the minimum. Never log PII or tokens.
8. **Everything observable.** Every service emits OpenTelemetry traces, RED metrics and structured logs. Every product
   feature emits analytics events defined in `docs/standards/ANALYTICS_EVENTS.md`.
9. **Decisions are written.** Any architectural choice that is costly to reverse requires an ADR in `docs/adr/`.
10. **Small, reversible, verified changes.** Feature flags for anything user-visible; no change is "done" without
    passing the Definition of Done (`docs/standards/DEFINITION_OF_DONE.md`).

## 2. Repository map

```
apps/
  mobile/            React Native (Expo) app — iOS & Android          owner: mobile-engineer
  web/               Next.js web platform (community, profiles, B2B)  owner: frontend-web-engineer
  admin/             Back-office: lexicon, liveops, moderation, B2B   owner: frontend-web-engineer
services/
  gateway/           API gateway / BFF (GraphQL + REST)              owner: backend-engineer
  identity/          Accounts, auth, social graph, clans             owner: backend-engineer
  game/              Match lifecycle, game state, server authority   owner: game-engine-engineer
  realtime/          WebSocket edge, presence, spectating            owner: realtime-engineer
  matchmaking/       Queues, Glicko-2 rating, tournaments            owner: realtime-engineer
  knowledge/         Lexicon API, knowledge graph, search            owner: lexicon-engineer
  ai/                Coach, bots orchestration, content pipeline     owner: ai-engineer
  progression/       XP, skill profile, missions, achievements, seasons owner: backend-engineer
  integrity/         Anti-cheat, fraud, collusion detection          owner: security-engineer
  commerce/          Store, CODELEX+, receipts validation, B2B licences owner: backend-engineer
packages/
  game-engine/       Pure rules engine (board, scoring, powers, modes) owner: game-engine-engineer
  lexicon/           Lexicon schema, seed data, validators           owner: lexicon-curator
  protocol/          Typed client↔server messages (zod) + versioning owner: realtime-engineer
  bots/              Deterministic AI opponents (Beginner→Grandmaster) owner: ai-engineer
  design-system/     Tokens, components (mobile + web)               owner: ux-ui-designer
  i18n/              Message catalogs, ICU formatting                owner: frontend-web-engineer
  observability/     OTel setup, logger, metrics helpers             owner: devops-sre
  config/            Shared eslint/tsconfig/prettier                 owner: devops-sre
infra/
  terraform/         Cloud foundations, multi-region                 owner: devops-sre
  k8s/               Helm charts, ArgoCD apps                        owner: devops-sre
docs/                Vision, architecture, ADRs, standards, game rules, runbooks
tools/               Repo tooling (framework validator, codegen)
.claude/             Agentic framework: agents, skills, hooks, settings
```

Directories that do not exist yet are created by their owner agent following `docs/roadmap/ROADMAP.md`.

## 3. Tech stack (see ADRs for rationale)

| Concern | Choice | ADR |
|---|---|---|
| Language | TypeScript (strict) everywhere; Go allowed only for `services/realtime` if load tests demand it | 0001, 0004 |
| Monorepo | pnpm workspaces + Turborepo | 0001 |
| Mobile | React Native + Expo (EAS), Reanimated, react-native-skia for the board | 0002 |
| Web | Next.js (App Router) | 0002 |
| API | Fastify services, GraphQL gateway for clients, gRPC/Connect between services | 0003 |
| Real-time | WebSocket edge, server-authoritative tick-less turn engine, Redis for hot state | 0004 |
| Data | PostgreSQL (primary), Redis (hot state, leaderboards), Kafka (events), S3-compatible object storage (replays) | 0005 |
| Knowledge graph | PostgreSQL adjacency tables + pgvector; graph DB deferred until proven need | 0006 |
| Rating | Glicko-2 per mode, seasonal soft reset | 0007 |
| AI | Claude API for Coach & content tooling (never in the gameplay hot path); deterministic search bots for opponents | 0008 |
| Infra | Kubernetes, Terraform, Helm, ArgoCD, multi-region active-active for realtime | 0009 |
| Observability | OpenTelemetry → Prometheus/Grafana/Tempo/Loki, Sentry for clients | 0009 |
| Validation | zod at every trust boundary | 0003 |
| Tests | Vitest, fast-check (property tests for game-engine), Playwright (web), Maestro (mobile), k6 (load) | 0010 |

## 4. How work flows (the agentic workflow)

The main session is the **orchestrator**. It does not do specialist work blindly; it routes to the right agent
(`.claude/agents/`) and drives the lifecycle defined in `docs/framework/AGENTIC_WORKFLOW.md`:

```
Idea → /feature-spec (product-strategist + game-designer)
     → /design (solution-architect [+ ADR] + owner agents + security-engineer threat model)
     → /implement (owner engineer agents, test-first)
     → /review (code-reviewer + security-engineer + qa-engineer, in parallel)
     → /ship (devops-sre: flags, migration plan, rollout, dashboards)
     → measure & iterate (data-analyst readout; /season-plan for LiveOps content)
```

Routing table — **who owns what**:

| Domain | Primary agent | Must consult |
|---|---|---|
| Product scope, priorities, KPIs | `product-strategist` | `data-analyst` |
| Rules, modes, powers, balance, economy feel | `game-designer` | `game-engine-engineer`, `monetization-liveops` |
| Cross-service design, ADRs, contracts | `solution-architect` | owner agents |
| `packages/game-engine`, `services/game` | `game-engine-engineer` | `game-designer` |
| Lexicon content (terms, definitions, relations) | `lexicon-curator` | `lexicon-engineer` |
| `services/knowledge`, graph, search | `lexicon-engineer` | `lexicon-curator` |
| Gateway, identity, social, clans, progression, commerce | `backend-engineer` | `security-engineer` |
| Realtime, matchmaking, tournaments, spectating | `realtime-engineer` | `game-engine-engineer` |
| `apps/mobile` | `mobile-engineer` | `ux-ui-designer` |
| `apps/web`, `apps/admin` | `frontend-web-engineer` | `ux-ui-designer` |
| UX flows, design system, accessibility, brand | `ux-ui-designer` | `product-strategist` |
| Coach, bots, AI content pipeline | `ai-engineer` | `game-designer`, `privacy-compliance` |
| Anti-cheat, authz, threat models, secrets | `security-engineer` | `realtime-engineer` |
| Infra, CI/CD, observability, SLOs, DR | `devops-sre` | `security-engineer` |
| Test strategy, E2E, load, release QA | `qa-engineer` | owner agents |
| Analytics events, dashboards, experiments | `data-analyst` | `product-strategist` |
| Seasons, store, CODELEX+, events, B2B/EDU offers | `monetization-liveops` | `game-designer`, `privacy-compliance` |
| GDPR/COPPA/store policies, ToS, data retention | `privacy-compliance` | `security-engineer` |
| Docs, changelogs, developer guides | `tech-writer` | owner agents |
| Final diff review | `code-reviewer` | — |

## 5. Engineering rules (summary — full text in `docs/standards/ENGINEERING.md`)

- TypeScript `strict`, no `any` (use `unknown` + zod), no non-null assertions in production code.
- Pure functions in `packages/game-engine`: no `Date.now()`, no `Math.random()`, no I/O. Inject clock and seeded RNG.
- Every external input is parsed with zod at the boundary; internal code trusts types.
- Protocol messages are versioned (`packages/protocol`); breaking changes require a new version and a deprecation window.
- DB migrations are forward-only, backward-compatible (expand → migrate → contract) and reviewed by `backend-engineer`.
- Errors: typed domain errors; never leak stack traces or internals to clients.
- Logging: structured JSON via `packages/observability`; never log PII, tokens, receipts, raw chat.
- Feature flags for every user-visible change; kill switch for every power, mode and store item.
- Conventional Commits (`feat(game-engine): …`). One logical change per commit. Branches: `feat/…`, `fix/…`, `chore/…`.
- Tests: unit next to code (`*.test.ts`), property tests for rules/scoring, contract tests for protocol, E2E for flows.
  Coverage floor: 90% lines for `packages/game-engine` and `packages/protocol`, 80% elsewhere.

## 6. Commands

```bash
pnpm install                 # install workspace
pnpm validate                # framework + lexicon + docs validation (runs in CI)
pnpm lexicon:validate        # validate lexicon data against schema and graph invariants
pnpm framework:validate      # validate .claude agents/skills/hooks/settings
pnpm -r test                 # all package tests (once packages exist)
pnpm turbo run lint typecheck test --filter=...[origin/main]   # affected only
```

## 7. Guardrails for agents

- Read the owning agent's scope before editing a directory you don't own; if the change crosses ownership, involve
  the owner agent or `solution-architect`.
- Never weaken a test, a lint rule, a security control or a CI gate to make something pass. Fix the cause.
- Never commit secrets, `.env` files, signing keys, store credentials or real user data (hooks enforce this).
- Never run destructive infra commands (`terraform apply/destroy` on non-dev, `kubectl delete` on prod contexts,
  force-push to `main`). Hooks block them; do not try to bypass.
- When information is missing, write the assumption explicitly in the spec/PR and pick the reversible option.
- Product language in UI: intelligent but not academic, competitive but not aggressive, tech but accessible.
