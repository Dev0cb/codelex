# @codelex/design-system

Tokens, components (mobile + web)

- Owner: `ux-ui-designer`
- Coverage preset: `base` (`@codelex/config/vitest`)
- Scaffolded by `tools/scaffold/scaffold.mjs`. Replace the placeholder API below with the real one.

## API

`designSystemVersion()`.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/design-system
```

## Invariants

1. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
