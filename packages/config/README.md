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
  `packages/*` only (a service may import itself, never another service); `packages/*` never import apps or
  services; `packages/game-engine` imports only `packages/lexicon`, `packages/config` and itself.
  Workspace imports (`@codelex/x`) are resolved through `eslint-import-resolver-typescript`, so they are
  classified like relative imports.
- Determinism (ENGINEERING §3) in `packages/game-engine` and `packages/bots`: `Date.now`, `new Date()`,
  `Date()`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `performance.now` are errors.
- Purity in `packages/game-engine`: Node built-ins (`fs`, `node:*`, ...), IO libraries and UI frameworks cannot
  be imported.

### Coverage rules

Thresholds apply to lines, statements, functions and branches. `defineCodelexVitest` accepts overrides that
raise a threshold and throws when an override would lower it. Strict is mandatory for `packages/game-engine`,
`packages/protocol` and this package.

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
   which runs the real ESLint API on the fixtures in `test/fixtures/repo` (copied to a scratch repo root so that
   `apps/*`, `services/*`, `packages/*` paths are real). Never delete a `bad-*` fixture to make a build pass.
3. Coverage thresholds can only be raised by consumers.
4. `tsconfig.base.json` stays at the repository root (design note §4).
5. No default exports, except tooling config files.
