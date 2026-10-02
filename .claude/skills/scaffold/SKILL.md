---
name: scaffold
description: Create a new workspace package, service or app following CODELEX conventions (layout, tsconfig, eslint, vitest, README with owner, observability, Dockerfile/Helm for services, CI wiring). Use whenever a directory listed in CLAUDE.md does not exist yet and work needs it.
argument-hint: "<packages|services|apps>/<name>"
---

# Scaffold

Target: $ARGUMENTS

1. Confirm the target is in the repository map of `CLAUDE.md` §2 (if not, it needs `/adr` first) and identify the
   owner agent; delegate to it with `devops-sre` for tooling.
2. Generate with the deterministic generator (never hand-write the boilerplate):
   `node tools/scaffold/scaffold.mjs <packages|services>/<name> [--owner <agent>] [--preset base|strict]
   [--description "…"] [--unlisted]`. Owner and description default to the `CLAUDE.md` §2 entry; the generator
   refuses unlisted targets (`--unlisted` with `--owner` is for throwaway probes only), unknown owner agents, a name
   already used by any workspace package, and a non-strict preset for `packages/game-engine` and `packages/protocol`.
   Dev-dependency versions are copied from the root `package.json`.
   It writes, for every target:
   - `package.json` `@codelex/<name>` (ESM, `exports` from `dist/`, scripts `build`, `lint`, `typecheck`,
     `format:check`, `test`), `devDependencies` on `@codelex/config` and the repo-pinned Vitest/fast-check versions;
   - `tsconfig.json` extending `../../tsconfig.base.json`, `tsconfig.build.json`, `turbo.json`;
   - `eslint.config.js` (`codelex()` from `@codelex/config/eslint`: strict type-checked rules, boundaries,
     determinism/purity for game-engine and bots), `prettier.config.js`, `.prettierignore`;
   - `vitest.config.ts` with `basePreset` (80 %) or `strictPreset` (90 %) from `@codelex/config/vitest`;
   - `README.md` (owner, preset, commands, invariants), `src/index.ts` and one meaningful test.
   Services additionally get `src/domain` (pure `healthReport` with a property test), `src/app/logger.ts` built on
   `@codelex/observability` (`createLogger`, redaction built in).
3. Run `pnpm install && pnpm turbo run lint typecheck format:check test --filter=@codelex/<name>`; it must be green
   before any real code is added. Then replace the placeholder API and README sections with the real ones, test-first.
4. If the target opens a new owner area, add it to `.github/CODEOWNERS`.

Not generated yet (each arrives with the epic that first needs it): `apps/*` (Expo/Next ESLint presets, bundle
budgets — E-1.4/E-1.5); for services, the HTTP framework, health/readiness endpoints and a `dev` script, config parsed with zod
from env, OTel bootstrap, `Dockerfile` and Helm values (E-2.x, E-2.9). Add them by hand following
`docs/standards/ENGINEERING.md` until the generator supports them.

The CI job "Scaffold golden path (timed)" runs the generator on a throwaway package and service (and on
`packages/game-engine` while it does not exist) on every pull request and push to `main`, and fails if scaffold → green exceeds 10 minutes; keep it green when changing the generator or `@codelex/config`.
