# @codelex/i18n

Message catalogs, ICU formatting

- Owner: `frontend-web-engineer`
- Coverage preset: `base` (`@codelex/config/vitest`)
- Scaffolded by `tools/scaffold/scaffold.mjs`. Replace the placeholder API below with the real one.

## API

`i18nVersion()`.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/i18n
```

## Invariants

1. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
