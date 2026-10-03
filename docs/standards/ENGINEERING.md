# Engineering Standards

Applies to all code. Enforced by lint, CI and the `code-reviewer` agent.

## 1. TypeScript
- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- No `any`; use `unknown` and parse with zod. No non-null assertion (`!`) outside tests.
- Prefer discriminated unions and exhaustive `switch` with `assertNever`.
- Return `Result<T, E>` (from `@codelex/config/result`) in domain code instead of throwing for expected failures;
  throw only for programmer errors.
- ESM only, Node 22 LTS, `type: module`. Named exports; no default exports except framework requirements (Next.js).
- File names kebab-case; types PascalCase; functions camelCase; constants SCREAMING_SNAKE_CASE only for true
  constants.

## 2. Architecture rules (lint-enforced boundaries)
- `apps/*` may import `packages/*` only. `services/*` may import `packages/*` only. No service imports another
  service's code. `packages/game-engine` imports nothing but `packages/lexicon` types and pure utilities.
- Domain layer has no framework/IO imports. Infra adapters implement domain ports.
- Shared contracts only in `packages/protocol`.

## 3. Determinism (game-engine, bots, Daily, chains)
- No `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` or iteration over unordered sources
  without sorting. Use injected `Clock` and `Rng` (seeded, e.g. PCG32/xoshiro128**).
- Floating point: scoring uses integers only.

## 4. Errors & API responses
- Domain errors are typed (`code`, `message`, `details`); mapped to RFC 9457 problem+json at the edge.
- Never return stack traces or internal identifiers to clients. Correlate with `traceId`.

## 5. Data & migrations
- Forward-only migrations; expand → migrate → contract across separate deploys. No `DROP` of a column still read
  by the previous release. Large backfills batched, resumable, observable.
- Every query bounded (`LIMIT`, cursor pagination). Index for each access pattern; `EXPLAIN` in PR for new
  hot queries.
- Monetary values in minor units (integers) with ISO currency.

## 6. Security & privacy (see also security-engineer agent)
- zod validation at every trust boundary; authz check in every use-case; tenant (`orgId`) scoping tested.
- No PII/secrets/tokens in logs, traces, analytics, error messages or LLM prompts.
- Dependencies: justify each new one in the PR (size, maintenance, license — allowlist: MIT, Apache-2.0, BSD,
  ISC, MPL-2.0, BlueOak-1.0.0 (approved 2026-10-02); anything else needs approval).
- Licences approved outside the allowlist **for build tooling only** (product owner, 2026-10-03, PR #48, on the
  security-engineer assessment of the same day). None is in the Hermes bundles of `expo export` (verified by source
  map); all are toolchain code that runs on developer and CI machines only. The approval does not cover shipping them:

  | Package | Licence | Arrives via | Assessment |
  | --- | --- | --- | --- |
  | `argparse` 2.0.1 | Python-2.0 (permissive, OSI) | `expo` > `@expo/cli` > `@expo/xcpretty` > `js-yaml`; also dev tooling | Approved, build tooling only |
  | `big-integer` 1.6.52 | Unlicense (public-domain dedication) | `expo` > `@expo/cli` > `bplist-parser` | Approved, build tooling only |
  | `stream-buffers` 2.2.0 | Unlicense | `expo` > `@expo/cli` > `bplist-creator` | Approved, build tooling only |
  | `caniuse-lite` 1.0.30001814 | CC-BY-4.0 (data) | `expo` > `@expo/metro-config` > `browserslist` | Approved, build tooling only (data); attribution needed if ever redistributed |

  The approval lapses if any of them appears in a bundle, a service image or another shipped artefact; then it needs
  a new decision.

## 7. Observability
- Logger from `@codelex/observability` (JSON lines, pino-compatible shape, zero runtime deps, mandatory redaction). Levels: `error` (actionable), `warn`, `info` (business
  events, sparse), `debug` (off in prod).
- One span per use-case and per external call; RED metrics per endpoint; business metrics named
  `codelex_<domain>_<metric>_<unit>`.

## 8. i18n & a11y
- No hard-coded user-facing strings; ICU messages in `packages/i18n` (EN + FR mandatory).
- Dates/numbers via `Intl`. Layout RTL-ready. WCAG 2.2 AA web; platform a11y APIs mobile.

## 9. Git & PRs
- Conventional Commits; scope = package or service (`feat(game-engine): add cross-word scoring`).
- Branches `feat/*`, `fix/*`, `chore/*`, `docs/*`. Small PRs (< 400 changed lines excluding generated/data).
- PR template filled; linked spec/ADR; screenshots/video for UI; migration & rollout notes.
