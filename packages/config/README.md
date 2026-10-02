# @codelex/config

Shared lint, format and test configuration for the whole monorepo, plus the zero-dependency `Result` type.
It is where `docs/standards/ENGINEERING.md` §1–§3 become executable.

- Owner: `devops-sre`
- Decision: ADR-0012 (ESLint flat config + typescript-eslint `strictTypeChecked` + eslint-plugin-boundaries +
  Prettier). Design: `docs/architecture/notes/config-package.md`.
- TypeScript is pinned to 6.0.3 (exact) in the root `package.json`; typescript-eslint supports `< 6.1.0`.

## API (subpath exports only, no root export, ESM, built with `tsc` to `dist/`)

| Import                     | Exports                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@codelex/config/result`   | `Result<T, E>`, `Ok<T>`, `Err<E>`, `ok()` / `ok(value)`, `err(error)`, `isOk`, `isErr`. Plain objects `{ ok: true, value }` / `{ ok: false, error }`. Zero dependencies, allowed in `game-engine`. |
| `@codelex/config/eslint`   | `codelex({ tsconfigRootDir, repoRoot? })` returns the full flat config. Building blocks: `genericPreset(options)`, `boundariesPreset(options)`, `gameEnginePreset()`, `findRepoRoot(dir)`.         |
| `@codelex/config/prettier` | `prettierConfig`                                                                                                                                                                                   |
| `@codelex/config/vitest`   | `basePreset` (80 %), `strictPreset` (90 %), `defineCodelexVitest(preset, overrides?)`                                                                                                              |

### What the ESLint preset enforces

- typescript-eslint `strictTypeChecked` with `projectService` (`no-floating-promises`, `no-explicit-any`,
  `no-non-null-assertion` except in tests, `switch-exhaustiveness-check`, ...), `consistent-type-imports`,
  `import-x/no-cycle`, `import-x/no-default-export` (off for `*.config.*`), `eslint-config-prettier` last.
- Boundaries (ENGINEERING §2, `boundaries/dependencies`, default disallow): `apps/*` and `services/*` import
  `packages/*` (including `packages/game-engine`) only; a service may import itself, never another service;
  `packages/*` never import apps or services; `packages/game-engine` imports only `packages/lexicon`,
  `packages/config` and itself. Workspace imports (`@codelex/x`) are resolved through
  `eslint-import-resolver-typescript`, so they are classified like relative imports, and an unresolvable
  `@codelex/*` import fails (`import-x/no-unresolved`) instead of silently bypassing the rule.
- Determinism (ENGINEERING §3) in `packages/game-engine` and `packages/bots`: `Date.now`, `new Date()`,
  `new Date(...spread)`, `Date()`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`,
  `performance.now`; aliasing (`const M = Math`, `const { random } = Math`), computed access on those objects, and
  `globalThis` / `global` / `self` / `window` are errors.
- ADR-0013 §D4 bans (all in the determinism block, so engine and bots, tests and tooling configs included unless
  stated; see the decision table below).
- Purity in `packages/game-engine`: an import allow-list (`codelex/pure-imports`): relative imports,
  `@codelex/lexicon` and its subpaths (the engine uses `@codelex/lexicon/index`), and `@codelex/config/result`
  only. Test files and tooling configs (`*.config.*`) are exempt
  from the purity rules (they import Vitest, fast-check and `@codelex/config`) but not from determinism. It covers static imports, re-exports, `import()`,
  `require()` and `import x = require()`; non-literal specifiers are rejected. IO and environment globals
  (`fetch`, `process`, timers, `XMLHttpRequest`, `WebSocket`, `Buffer`, ...) are banned.
- The determinism/purity configs are anchored with `basePath: repoRoot`, so they apply whatever the cwd or the
  location of `eslint.config.js` (per-package config run by turbo, or a single root config).
- Not yet available: the `react: 'expo' | 'next'` option of the design note. It is deferred until the first app is
  scaffolded (S5+), when `eslint-config-expo` / `@next/eslint-plugin-next` are added.

### ADR-0013 §D4 lint decisions

The items of §D4.1-2 marked (L) are enforced as listed below; the rest of §D4 (3 total-order comparators, 4 iteration
order, 5 ASCII data, 7-8 bot ties and recursion) is not statically decidable and stays with tests and review.
"Shipped" means files that are not tests (`*.test.*`, `test/**`); tooling configs count as shipped. Purity
(engine only) keeps its own scope: import allow-list and IO globals. No §D4 item is a purity item: they all make
results differ between runtimes (Node, Hermes) and therefore belong to determinism, which also covers `packages/bots`
(bots have no import allow-list, hence the explicit module and timer bans).

| Ban                                                                                                                                                                                                                                                          | Scope                | Rule                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | -------------------------- |
| Globals `Date`, `crypto`, `performance` (whole objects, not only `now`/`random`), `Intl`, `TextEncoder`, `TextDecoder`, `parseFloat`, `Reflect`, `WeakRef`, `FinalizationRegistry`, `process`, `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask` | engine + bots, tests | `no-restricted-globals`    |
| `BigInt`, `BigInt64Array`, `BigUint64Array`, `Promise` (value and `Promise<T>` type references), `1n` literals, `bigint` type, `async` functions, `await`, `for await`, `import()`                                                                           | shipped only         | globals / syntax           |
| Imports of `crypto`, `perf_hooks`, `timers`, `timers/promises`, `worker_threads`, `async_hooks` (bare and `node:`)                                                                                                                                           | shipped only         | `no-restricted-imports`    |
| `localeCompare`, `toLocale*`, `.normalize()` (dot, `['x']` and template-literal keys)                                                                                                                                                                        | engine + bots, tests | `no-restricted-syntax`     |
| `sort()` / `toSorted()` with no argument, `undefined`, `void 0` or a spread; `.call/.apply/.bind` on sort, toSorted, localeCompare, normalize, toLocale\*                                                                                                    | engine + bots, tests | `no-restricted-syntax`     |
| `Math.pow sqrt cbrt hypot exp expm1 log log1p log2 log10 sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh fround`, `Math.PI E LN2 LN10 LOG2E LOG10E SQRT2 SQRT1_2`, `Number.EPSILON`, `Number.parseFloat`                                   | engine + bots, tests | `no-restricted-properties` |
| `**` / `**=` unless both operands are literals (`2 ** 29` is fine, `x ** 2` is not)                                                                                                                                                                          | engine + bots, tests | `no-restricted-syntax`     |
| Fractional numeric literals (`0.5`, `.5`, `1e-3`, `1_000.5`; hex/octal/binary and `1e3` are integers)                                                                                                                                                        | shipped only         | `no-restricted-syntax`     |
| `JSON.stringify`                                                                                                                                                                                                                                             | shipped only         | `no-restricted-properties` |

Decisions and limits:

- **Tests are exempt** from BigInt (ADR text), fractional literals (tests probe rejection of `1.5`, `0.5`),
  `JSON.stringify` (comparison in assertions), async/await/`Promise`/`import()` (`fc.asyncProperty`,
  `expect().resolves`) and the module-import bans (`node:crypto` is a legitimate SHA-256 oracle in
  `sha256.test.ts` / `rng.test.ts`; the engine itself never imports it). Tests are still bound by the global bans, so a
  test cannot read the clock, `crypto.getRandomValues`, timers or `process`.
- The ADR bans `JSON.stringify` only "for anything hashed or compared", which a linter cannot see, so shipped code is
  banned wholesale: hashed content goes through the canonical serialiser.
- `**` cannot be proved integer-only statically, so the rule is conservative: only literal-to-literal is accepted.
  Allow-list a justified use narrowly with `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
- `sort()` detection is syntactic and untyped: any `.sort()` / `.toSorted()` call with zero arguments is flagged,
  including typed arrays (numeric default, but pass a comparator anyway). Likewise any user-defined method named
  `normalize`, `sort`, `toSorted`, `localeCompare` or `toLocale*` is flagged: bots and engine code should name their
  own vector/score operations differently (`normalizeScores`, `rank`). Comparator totality is a review/test matter.
  Aliasing a method without calling it (`const f = [].sort; f(xs)`) is not detected.
- `Math.floor`, `Math.imul`, `Math.min/max/abs/trunc/sign/clz32` and `/` stay allowed (exact integer division is
  written `Math.floor(a / b)` with operands < 2^26, ADR §D4.1).
- Not linted: §D4.5 regex `i`/`u` flags (only banned "on game data", which is not identifiable) and `Map`/`Set`
  iteration order.

### Coverage rules

Thresholds apply to lines, statements, functions and branches. `defineCodelexVitest` accepts overrides that
raise a threshold and throws when an override would lower it, disable coverage (`coverage.enabled`), override
`coverage.include`, exclude anything but test-only patterns, or add unknown threshold keys (`perFile` and `100: true` are
allowed). Strict is mandatory for `packages/game-engine`,
`packages/protocol` and this package.

## Result conventions

`ok()` returns `Ok<void>`: use `Result<void, E>` for operations that succeed without a value. Narrow with
`if (r.ok)`; `E` is always a typed domain error (`code`, `message`, `details`), never a bare string in domain code.

## How packages consume it

```
package.json        devDependencies: "@codelex/config": "workspace:*"
                    (dependencies instead if runtime code imports "@codelex/config/result")
eslint.config.js    import { codelex } from '@codelex/config/eslint';
                    export default codelex({ tsconfigRootDir: import.meta.dirname });
prettier.config.js  export { prettierConfig as default } from '@codelex/config/prettier';
vitest.config.ts    import { basePreset, defineCodelexVitest } from '@codelex/config/vitest';
                    export default defineCodelexVitest(basePreset);
scripts             lint: eslint .   format:check: prettier --check .   test: vitest run --coverage
```

ESLint, Prettier, Vitest, typescript-eslint and the plugins are optional peer dependencies of this package and
root devDependencies, so one version is resolved repo-wide. `lint`, `typecheck` and `test` depend on `^build`
in `turbo.json`, so `pnpm turbo run lint` always builds this package first.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/config
```

## Invariants

1. `./result` stays dependency-free and deterministic.
2. A forbidden import or a determinism violation must fail lint: this is asserted by `test/eslint.test.ts`,
   which runs the real ESLint API on the fixtures in `test/fixtures/repo` (copied to a scratch repo under
   `os.tmpdir()`), both in the consumer layout (per-package `eslint.config.js` from the built `dist`, cwd = package
   dir) and with the source preset from the repo root. `test/coverage.test.ts` runs a real `vitest --coverage` on
   fixtures and asserts the threshold failure. Never delete a `bad-*` fixture to make a build pass.
3. Coverage thresholds can only be raised by consumers.
4. `tsconfig.base.json` stays at the repository root (design note §4).
5. No default exports, except tooling config files.
