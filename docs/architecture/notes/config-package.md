# Design note — `@codelex/config`

- Status: Proposed (depends on ADR-0012, Proposed) · Date: 2026-10-02 · Owner: devops-sre · Author: solution-architect
- Sprint: `docs/sprints/2026-10-02-phase0-close.md` — S1 (this note), S2 (implementation), S5 (scaffold wiring)

## 1. Purpose
One workspace package that every app, service and package depends on (as a devDependency, except `./result`)
to get identical lint, format, test and coverage rules, plus the zero-dependency `Result` type required by
`docs/standards/ENGINEERING.md` §1. It is the single place where ENGINEERING §1–§3 become executable.

Non-goals: no runtime utilities beyond `Result`; no tsconfig presets (see §4); no build tooling.

## 2. Export map

```jsonc
// packages/config/package.json (shape; versions and pins are S2's job)
{
  "name": "@codelex/config",
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./eslint":   { "types": "./dist/eslint/index.d.ts",   "default": "./dist/eslint/index.js" },
    "./prettier": { "types": "./dist/prettier/index.d.ts", "default": "./dist/prettier/index.js" },
    "./vitest":   { "types": "./dist/vitest/index.d.ts",   "default": "./dist/vitest/index.js" },
    "./result":   { "types": "./dist/result/index.d.ts",   "default": "./dist/result/index.js" }
  }
}
```

- No root (`"."`) export: consumers import the subpath they need, so a runtime import of `./result` never
  pulls ESLint or Vitest into a bundle.
- Sources in `src/<entry>/index.ts`, built with `tsc` to `dist/`. Tooling entries must be plain JS at runtime
  because ESLint, Prettier and Vitest load them with Node (the Node 22.12 floor of the time did not
  guarantee type stripping; the floor is 22.18 since sprint 4 D1, and the built `dist/` stays the contract). `turbo.json` already makes `lint`, `typecheck` and `test` depend on `^build`.
- ESLint, Prettier, Vitest, typescript-eslint and plugins are `peerDependencies` of `@codelex/config` and
  `devDependencies` of the root workspace, so one version is resolved repo-wide.

| Subpath | Export (named, no default) | Content |
|---|---|---|
| `./eslint` | `codelex(options)` → flat config array | typescript-eslint `strictTypeChecked` with `projectService`; `eslint-plugin-boundaries` element types and edges (ENGINEERING §2); an import allow-list rule (`codelex/pure-imports`) and `no-restricted-globals` for IO in game-engine, plus `no-restricted-properties`/`no-restricted-syntax` for `Date.now`, `new Date()`, `Math.random`, `crypto.randomUUID` in `packages/game-engine` and `packages/bots` (§3); `no-non-null-assertion` relaxed only in `*.test.ts`; `eslint-config-prettier` last. Options: `{ tsconfigRootDir: string; repoRoot?: string }`; the `react?: 'expo' \| 'next'` option is deferred until the first app is scaffolded (S5+) because the Expo/Next plugins are not installed yet. |
| `./prettier` | `prettierConfig` | Single Prettier config object (consumers re-export it). |
| `./vitest` | `basePreset`, `strictPreset`, `defineCodelexVitest(preset, overrides?)` | Coverage provider v8, reporters `text-summary` + `lcov`; thresholds on **lines, statements, functions and branches** (product owner decision, 2026-10-02): base 80 %, strict 90 % (ADR-0010). Strict is mandatory for `packages/game-engine` and `packages/protocol`; `packages/config` itself uses strict. Overrides may raise thresholds, never lower them (the helper throws). |
| `./result` | `Result`, `Ok`, `Err`, `ok`, `err` | See §3. The only runtime export; zero dependencies. |

Boundary model encoded in `./eslint` (element types by path from the repo root):

| From | May import |
|---|---|
| `apps/*` | `packages/*` |
| `services/<x>` | `packages/*`, own files in `services/<x>` |
| `packages/game-engine` | `packages/lexicon` (types), `@codelex/config/result`, own files |
| `packages/*` (others) | `packages/*` (no cycles) |
| anything | never `apps/*`, never another `services/*` |

## 3. `Result<T, E>`

```ts
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function err<E>(error: E): Err<E>;
```

- Discriminated union on `ok`; callers narrow with `if (r.ok)`; no class, no prototype, no methods —
  values are plain objects, serialisable and structurally comparable in tests.
- Zero dependencies, no IO, deterministic: allowed inside `packages/game-engine`.
- `E` has no default: every domain declares its typed error union (ENGINEERING §4, `code`/`message`/`details`).
- Combinators (`map`, `andThen`, `all`) are deliberately **not** included in v1; add only when ≥ 2 packages
  need the same one (reversible, additive).
- Tests (S2): unit tests for both constructors and narrowing (type-level tests via `expectTypeOf`), fast-check
  property: `ok(x).ok === true && ok(x).value === x` and `err(e).ok === false && err(e).error === e` for
  arbitrary values; strict preset (≥ 90 %).

## 4. TypeScript configuration stays at the root
`tsconfig.base.json` remains at the repository root and is **not** moved into `@codelex/config`. The
`/scaffold` skill (`.claude/skills/scaffold/SKILL.md`) generates `tsconfig.json` with
`"extends": "../../tsconfig.base.json"`, and every package lives exactly two levels deep (`apps/*`,
`services/*`, `packages/*`). Moving it would be a breaking change for scaffold and for every package with no
benefit. Per-platform needs (DOM lib for Next.js, JSX for Expo) are added in the consuming package's
`tsconfig.json`, not in the base.

## 5. How packages consume it

```
packages/<name>/
  package.json        devDependencies: "@codelex/config": "workspace:*"
                      (dependencies instead, if runtime code imports "@codelex/config/result")
  tsconfig.json       { "extends": "../../tsconfig.base.json", ... }
  eslint.config.js    import { codelex } from '@codelex/config/eslint';
                      export default codelex({ tsconfigRootDir: import.meta.dirname });
  prettier.config.js  export { prettierConfig as default } from '@codelex/config/prettier';
  vitest.config.ts    import { defineCodelexVitest, basePreset } from '@codelex/config/vitest';
                      export default defineCodelexVitest(basePreset);
```

Default exports in these three files are a tooling requirement (allowed exception to the named-exports rule).
Scripts: `lint: eslint .`, `format:check: prettier --check .`, `test: vitest run --coverage`. `/scaffold`
is updated in S5 to emit exactly this layout.

## 6. NFR budget and observability
- Lint (type-aware) ≤ 30 s per small package cold, ≈ 0 on Turborepo cache hit; format check ≤ 5 s repo-wide.
  Affected-only CI p50 < 5 min (sprint indicator). Measured from Turborepo run summaries in CI.
- Availability/RPO/RTO/cost: not applicable (developer tooling, no runtime service).

## 7. Failure modes
| Failure | Effect | Mitigation |
|---|---|---|
| typescript-eslint does not support the pinned TS version | lint crashes or warns | TS pinned to 6.0.x (ADR-0012); Dependabot group for TS + typescript-eslint (`.github/dependabot.yml`) |
| Boundary rule misconfigured (false negative) | forbidden import passes CI | Fixture packages that **must fail** lint, asserted in `@codelex/config` tests (S2) |
| Consumer lowers coverage threshold | silent quality drop | `defineCodelexVitest` rejects lower thresholds, `coverage.include`, non-test `coverage.exclude`, disabling coverage; reviewed by code-reviewer |
| Package uses `basePreset` where `strictPreset` is mandatory (`packages/game-engine`, `packages/protocol`) | 80 % floor instead of 90 % | **Known gap**: nothing in `@codelex/config` knows which package is which. To be enforced by the S5 golden-path job / framework validator (assert the vitest config of those packages uses `strictPreset`) |
| `dist/` stale in local dev | rules differ from CI | `^build` dependency in `turbo.json`; `pnpm turbo run lint` always builds config first |

## 8. Rollout
1. S2: implement package, tests first (Result + fixtures that must fail); green with
   `pnpm turbo run lint typecheck test --filter=@codelex/config`.
2. S3: `packages/observability` is the first consumer.
3. S5: `/scaffold` emits the consumer files; golden-path CI job validates end to end.
4. Existing `packages/lexicon` (zero-dependency `.mjs` scripts, `lint` = validator) adopts the presets when it gains a
   TypeScript build; until then it is outside lint scope by design.
Rollback: delete the consumer files and the package; no runtime code depends on it except `./result`.
