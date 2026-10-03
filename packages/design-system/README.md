# @codelex/design-system

Design tokens and, from slice S1, the shared components (board renderer `BoardView`, buttons) for `apps/mobile` and
later the web apps. Today: a **partial** token set (chrome colours, type ramp, spacing) with the E-1.4 values, plus
WCAG contrast checks. No component yet: the `BoardView` contract (E-1.4 §2) is implemented in S1.

- Owner: `ux-ui-designer` (consult `mobile-engineer` for the React Native components, `frontend-web-engineer` for web)
- Coverage preset: `base` (`@codelex/config/vitest`)
- Scaffolded by `tools/scaffold/scaffold.mjs`.
- Spec: E-1.4 thin spec `docs/specs/E-1.4-design-system/design-system-v1.md`, which reuses the E-1.5 tokens
  (`docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.design.md` §7).

## Status: partial token set

`TOKENS_STATUS === 'partial'`: the chrome colour roles of §1.2 (dark and light), the system type ramp of §1.4 and
`space.0..8` of §1.5, with the spec values and flat camelCase keys (§1.1). One deviation, decided by the contrast
check per assumption A-2: light `accentPrimary` is `#00866A` instead of `#00876A` (white on `#00876A` is 4.49:1).
TODO(S1): board, tile, premium, category, mono type, radius, elevation, layout and motion tokens, `color.scrim`, and
the DTCG JSON files of §1.1 (`tokens/*.json`) generating this same typed shape (`Tokens`), so consumers do not change.

## API

- `getTokens(scheme)` → `{ status, scheme, color, space, type }`; `resolveColorScheme(osAppearance)` (dark default).
- Names: `COLOR_ROLES` (`bgBase`, `bgSurface`, `bgRaised`, `borderSubtle`, `textPrimary`, `textMuted`,
  `accentPrimary`, `accentOnPrimary`, `feedbackError|Warning|Info`), `SPACE_STEPS` (`0..8`), `TYPE_ROLES`
  (`display`, `title`, `heading`, `bodyL`, `body`, `bodyS`, `caption`).
- `contrastRatio(a, b)`, `contrastFailures(tokens)` against `CONTRAST_PAIRS` (text 4.5:1, UI 3:1).
  `borderSubtle` is excluded as a decorative separator (it never carries state).

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/design-system
pnpm --filter @codelex/design-system contrast   # contrast table per scheme (after build); exits 1 on failure
```

## Invariants

1. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
2. Apps never contain a literal colour, size or duration: they read tokens (E-1.4 §1.1).
3. Every scheme meets `CONTRAST_PAIRS` (enforced by the tests); hue never carries meaning alone.
4. Presentational only: no game rules, never imports `@codelex/game-engine`.
