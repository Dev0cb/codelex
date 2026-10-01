---
name: scaffold
description: Create a new workspace package, service or app following CODELEX conventions (layout, tsconfig, eslint, vitest, README with owner, observability, Dockerfile/Helm for services, CI wiring). Use whenever a directory listed in CLAUDE.md does not exist yet and work needs it.
argument-hint: "<packages|services|apps>/<name>"
---

# Scaffold

Target: $ARGUMENTS

1. Confirm the target is in the repository map of `CLAUDE.md` §2 (if not, it needs `/adr` first) and identify the
   owner agent; delegate to it with `devops-sre` for tooling.
2. Create:
   - `package.json` named `@codelex/<name>`, `"type": "module"`, scripts `build`, `lint`, `typecheck`, `test`,
     `dev` (services/apps); `tsconfig.json` extending `../../tsconfig.base.json`; `vitest.config.ts`.
   - `README.md`: purpose, owner agent, public API/contract, run/test commands, invariants.
   - `src/index.ts` and one meaningful passing test (no placeholder `expect(true)`).
   - Services additionally: `src/{api,app,domain,infra}`, health/readiness endpoints, OTel bootstrap via
     `@codelex/observability`, config parsed with zod from env, `Dockerfile` (multi-stage, distroless, non-root),
     `infra/k8s/charts/<name>/values.yaml` using the library chart.
3. Run `pnpm install && pnpm turbo run lint typecheck test --filter=@codelex/<name>` and fix until green.
4. Add the package to the CODEOWNERS-like table in `.github/CODEOWNERS` comments if a new owner area.
