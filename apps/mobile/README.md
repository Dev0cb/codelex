# @codelex/mobile

CODELEX for iOS and Android: React Native + Expo (ADR-0002), Expo Router, Hermes, New Architecture. Foundation
only (sprint A1): one placeholder Home screen that shows the app name from the i18n catalog and the rules-engine
version imported from `@codelex/game-engine`. Design note: `docs/architecture/notes/mobile-app-foundation.md`.

- Owner: `mobile-engineer` (consult `ux-ui-designer` for visuals, `realtime-engineer` for the protocol)
- Coverage: 80 % on lines, statements, functions and branches, read from `@codelex/config/vitest` `basePreset`
- Hand-written (the `/scaffold` generator does not support `apps/*` yet) following the package conventions.

## Stack (pinned)

Expo SDK 57 (`expo` 57.0.26), React Native 0.86.3, React 19.2.3, Expo Router 57.0.24, Reanimated 4.5.1 +
Worklets 0.10.1, Gesture Handler 2.32.0. SDK 57 has no `newArchEnabled` or `jsEngine` switch: the New Architecture
and Hermes are the only options, so both are pinned by the SDK version. Upgrade with `expo install --fix` one SDK at a
time, never to an SDK published less than 3 days ago (`minimumReleaseAge`).

## Layout

```
src/app/            Expo Router routes only (default exports allowed here, nowhere else)
src/features/<f>/   screens and feature components
src/i18n/           I18nProvider / useI18n over @codelex/i18n (device locale, EN fallback)
src/theme/          useTokens() over @codelex/design-system (OS appearance, dark default)
scripts/            bundle-size budget and bundle-contents check (node:test)
metro.config.cjs    Expo defaults + `clxi` asset extension (lexicon index)
bundle-budget.json  bytes per platform for the Hermes bundle and the bundled assets
bundle-forbidden-packages.json  toolchain packages that must never be bundled (audit exceptions)
```

## Commands

```bash
pnpm --filter @codelex/mobile start                  # Expo dev server (needs a dev build or Expo Go 57)
pnpm turbo run lint typecheck format:check test --filter=@codelex/mobile
pnpm turbo run bundle:check --filter=@codelex/mobile # expo export (Hermes bytecode + maps) + budget + contents
```

`build` is `expo export --platform android --platform ios --source-maps`: Metro plus `hermesc -O -output-source-map`
(the flags of a React Native release build) produce the Hermes bytecode bundles a store build embeds, on any Linux
host, without Xcode or the Android SDK. `bundle:check` compares them and the bundled assets to `bundle-budget.json`,
then fails if a package listed in `bundle-forbidden-packages.json` is a module in either source map: that is the
proof behind the toolchain audit exceptions in `docs/security/audit-exceptions.md`. Native binaries (EAS Build), cold-start and
60 fps measurements need devices and are not part of CI yet (sprint task H1).

## Rules

1. No hard-coded user-facing strings and no literal colours in `src` (lint, E-1.4 §5.1): `t(key)` and `useTokens()`.
2. The client never decides a game outcome: the engine runs here for previews only (CLAUDE.md §1.1).
3. Lint, format and coverage rules come from `@codelex/config`; app-specific rules only add restrictions.
4. No crash SDK in the playtest build (E-1.5 Q-1/Q-7): unclean-exit flag + TestFlight / Play Console statistics.
