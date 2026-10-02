# 0012 — Lint and format toolchain

- Status: Accepted (2026-10-02, product owner: option A; TypeScript pinned to 6.0.x)
- Date: 2026-10-02
- Deciders: product owner (human), solution-architect, devops-sre, security-engineer
- Reversibility: Two-way door (cheap while the workspace has < 5 packages; cost grows linearly with packages)

> ADR-0011 is reserved for protocol/event versioning (deferred to E-2.3, see sprint
> `docs/sprints/2026-10-02-phase0-close.md`). This ADR is numbered 0012 on purpose.

## Context
Sprint task S1 (Phase 0 close, epic E-0.2). `packages/config` must ship the shared lint/format setup before any
TypeScript package is scaffolded (S2, S5). Forces:

- **Architecture boundaries are lint-enforced** (`docs/standards/ENGINEERING.md` §2, ADR-0001 consequences):
  `apps/*` import `packages/*` only; `services/*` import `packages/*` only and never another service;
  `packages/game-engine` imports nothing but `packages/lexicon` types and pure utilities (no IO, no Node
  built-ins, no framework). This is the property that protects server authority and determinism
  (CLAUDE.md §1.1–1.2), so it is the first criterion, not a nice-to-have.
- **Type-aware rules** required by §1: `no-floating-promises`, `no-non-null-assertion` (outside tests),
  `no-explicit-any`. Determinism rules (§3: ban `Date.now`, `new Date()`, `Math.random`,
  `crypto.randomUUID` in game-engine/bots) are a strong bonus.
- **CI speed**: affected-only target is CI p50 < 5 min (sprint success indicator); Turborepo caches `lint` per
  package (`turbo.json`: `lint` depends on `^build`).
- **Ecosystem**: Expo (ADR-0002) and Next.js ship their recommended rules as ESLint configs/plugins
  (`eslint-config-expo`, `@next/eslint-plugin-next`); React hooks rules matter for both.
- **Licences** must be on the allowlist (§6).
- **Cost to reverse**: the choice touches every package config and the formatting of every file.

Versions below were read from the npm registry on 2026-10-02 (`npm view`); they inform compatibility, they are
not pins. Pins are set by S2 in the lockfile.

| Package | Latest | Licence | Note |
|---|---|---|---|
| `eslint` | 10.11.0 | MIT | flat config only |
| `typescript-eslint` | 8.71.0 | MIT | peer `typescript >=4.8.4 <6.1.0` |
| `eslint-plugin-boundaries` | 7.2.0 | MIT | peer `eslint >=6` |
| `eslint-plugin-import-x` | 4.17.1 | MIT | |
| `prettier` | 3.9.9 | MIT | |
| `eslint-config-prettier` | 10.1.8 | MIT | turns off stylistic rules |
| `@biomejs/biome` | 2.5.15 | MIT OR Apache-2.0 | |
| `eslint-config-expo` | 57.0.2 | MIT | bundles typescript-eslint 8, import, react, react-hooks |
| `@next/eslint-plugin-next` | 16.3.8 | MIT | peer `eslint >=9` |
| `typescript` | 7.0.2 (latest), 6.0.3 | Apache-2.0 | see "TypeScript version constraint" |

## Options considered

### Option A — ESLint flat config + typescript-eslint (type-aware) + eslint-plugin-boundaries + Prettier
- **Boundaries**: `eslint-plugin-boundaries` models *element types* (`app`, `service`, `package`,
  `game-engine`, `lexicon`) by path pattern and captures (e.g. service name), then allow-lists edges:
  `app → package`, `service → package | same service`, `game-engine → lexicon | config(result)`. Violations
  are reported with the rule that forbade them. Node built-ins and IO libraries are banned in game-engine with
  `no-restricted-imports` (`node:*`, `fs`, `net`, `http`, …) and determinism with `no-restricted-properties` /
  `no-restricted-syntax` (`Date.now`, `new Date()`, `Math.random`, `crypto.randomUUID`). `eslint-plugin-import-x`
  is kept only for hygiene rules (`no-cycle` on hot packages, `no-default-export` with Next.js exceptions);
  boundaries are not modelled with `import-x/no-restricted-paths` because zones are path-pair lists that grow
  with every service (N² maintenance) while boundaries rules stay O(element types).
- **Type-aware**: typescript-eslint `strictTypeChecked` gives `no-floating-promises`, `no-misused-promises`,
  `no-explicit-any`, `no-non-null-assertion`, `no-unsafe-*`, `switch-exhaustiveness-check` (supports the
  `assertNever` rule), all backed by the real TypeScript checker via `projectService`.
- **Speed**: type-aware linting is the slowest part of the pipeline (it builds a TS program per package).
  Mitigated by per-package lint under Turborepo cache + affected-only filter; with a dozen small packages
  this fits the 5-min p50. Prettier runs as `prettier --check` (fast, cacheable).
- **Ecosystem**: first-class. `eslint-config-expo` and `@next/eslint-plugin-next` plug in directly; React
  hooks, a11y (`jsx-a11y`, WCAG goal in §8) and security plugins exist.
- **Cost**: 6–8 dev dependencies, all MIT/Apache; config complexity concentrated in `@codelex/config/eslint`.
- **Risks**: (1) typescript-eslint lags new TypeScript majors — today it supports TS `< 6.1`, so the workspace
  must pin TS 6.0.x (or 5.9.x) while TS 7 is the npm `latest`; (2) boundary resolution of `@codelex/*`
  workspace imports needs a TypeScript-aware resolver configured once in the preset.

### Option B — Biome (lint + format, single binary)
- **Boundaries**: no element/edge model. Achievable only with per-directory `overrides` of
  `style/noRestrictedImports` (one block per app/service/package family) plus
  `correctness/noNodejsModules` for game-engine and `correctness/noPrivateImports`. "Services never import
  another service" needs one override per service listing every other service (or a deny-by-path pattern
  that must be kept in sync), and violations do not explain the architectural rule. Determinism bans
  (`Date.now`, `Math.random`) have no direct equivalent to `no-restricted-properties`; would need GritQL
  plugins.
- **Type-aware**: Biome 2 has its own type inference, not the TypeScript checker. In 2.5.15
  `noFloatingPromises` and `noMisusedPromises` are in the **nursery** group (unstable, opt-in);
  `noExplicitAny` (suspicious) and `noNonNullAssertion` (style) are stable but are syntactic. Coverage of
  floating promises through inferred/imported types is narrower than typescript-eslint's.
- **Speed**: substantially faster than ESLint+Prettier (Rust, no TS program; not yet measured on this repo);
  one tool, one config, one binary.
- **Ecosystem**: cannot run ESLint plugins, so the Expo and Next.js recommended rules are lost or must be
  re-approximated; React hooks rules exist in Biome but are not the upstream ones.
- **Cost**: one dev dependency (dual MIT/Apache), smallest config.
- **Risks**: the two criteria that matter most (boundaries, type-aware promise safety) are the weakest.

### Option C — Hybrid: Biome for formatting (+ fast syntactic lint), ESLint only for type-aware + boundary rules
- Faster format step than Prettier, keeps A's guarantees. But two linters with overlapping rule sets, two
  suppression syntaxes, two editor integrations, and the expensive part (type-aware ESLint) is unchanged, so
  the CI gain is small. Rejected for now; it remains the natural evolution path if formatting time becomes
  measurable (see "Revisit triggers").

### Comparison

| Criterion | A — ESLint + boundaries + Prettier | B — Biome | C — Hybrid |
|---|---|---|---|
| ENGINEERING §2 boundaries | Strong: element/edge model, explained violations | Weak: per-dir restricted-import lists, N² upkeep | Strong (ESLint part) |
| game-engine IO / determinism bans | Yes (`no-restricted-imports`, `-properties`, `-syntax`) | Partial (`noNodejsModules`; determinism needs GritQL) | Yes |
| Type-aware rules (§1) | Full, real TS checker | Partial, nursery for promises | Full |
| CI speed | Slowest; acceptable with Turbo cache + affected | Fastest | ≈ A |
| Expo / Next.js rules | Native | Lost / approximated | Native |
| Number of tools | 2 (+ plugins) | 1 | 3 |
| Cost to reverse | Low (one package + one reformat commit) | Low | Medium (two tools to unwind) |

## Decision
**Option A** — ESLint flat config with typescript-eslint `strictTypeChecked`, `eslint-plugin-boundaries` for the
dependency graph, `eslint-plugin-import-x` for import hygiene, `eslint-config-prettier`, and Prettier for
formatting; all shipped from `@codelex/config` (`./eslint`, `./prettier`). Design:
`docs/architecture/notes/config-package.md`.

Rationale: the boundary and type-aware rules are the controls that protect server authority, determinism and
async correctness; A enforces them with the real type checker and an explicit architecture model, and it is the
only option that keeps the Expo and Next.js recommended rules. B's speed advantage is real but buys time we do not
yet need (a handful of packages, Turbo cache) at the price of our most important guarantees. "Boring technology"
favours A.

### TypeScript version constraint
typescript-eslint 8.71.0 declares `typescript <6.1.0`, while the npm `latest` tag of TypeScript is 7.0.2.
The workspace pins **TypeScript 6.0.x** (exact pin in the root `package.json`, consumed by all packages) until
typescript-eslint supports TS 7. Typechecking with a faster TS 7 compiler in parallel is a separate decision,
not part of this ADR.

## Consequences
- Positive: one place (`@codelex/config/eslint`) encodes ENGINEERING §1–§3; a service→service import or an
  IO import in game-engine fails CI with a message naming the rule; editors show the same errors.
- Negative: type-aware lint is slow on large packages; TS major upgrades are gated by typescript-eslint; two
  tools (ESLint, Prettier) to keep in sync (handled by `eslint-config-prettier`).
- Follow-up (owner devops-sre, sprint S2): implement presets; fixture packages that **must fail** lint
  (service→service import, game-engine→`node:fs`, `Math.random` in game-engine, floating promise, `!`, `any`);
  update `/scaffold` (S5) to generate `eslint.config.js` and `.prettierrc` consumers; add a `format:check`
  task to CI via Turborepo.
- Monitor: `lint` task duration per package from Turborepo run summaries; CI p50 for affected-only runs.
- **Revisit triggers**: (1) affected-only CI p50 > 5 min with lint as the top contributor for two consecutive
  weeks → evaluate Option C (Biome formatter) or restricting type-aware rules to
  changed files; (2) Biome promotes
  floating-promise rules to stable *and* offers a dependency-boundary model → re-evaluate B; (3) typescript-eslint
  blocks a required TypeScript upgrade for > 1 quarter.
- Reversibility: all rules live in `@codelex/config`; packages only re-export the preset. Switching tool means
  rewriting one package, swapping devDependencies, and one mechanical reformat commit (excluded from blame
  via `.git-blame-ignore-revs`).
