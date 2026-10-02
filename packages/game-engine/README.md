# @codelex/game-engine

Pure rules engine (board, scoring, powers, modes)

- Owner: `game-engine-engineer`
- Coverage preset: `strict` (`@codelex/config/vitest`)
- Scaffolded by `tools/scaffold/scaffold.mjs`. Replace the placeholder API below with the real one.

## API

`gameEngineVersion()`.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/game-engine
```

## Invariants

1. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
