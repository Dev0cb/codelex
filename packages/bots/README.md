# @codelex/bots

Deterministic AI opponents (Beginner→Grandmaster)

- Owner: `ai-engineer`
- Coverage preset: `strict` (`@codelex/config/vitest`)
- Scaffolded by `tools/scaffold/scaffold.mjs`. Replace the placeholder API below with the real one.

## API

`botsVersion()`.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/bots
```

## Invariants

1. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
