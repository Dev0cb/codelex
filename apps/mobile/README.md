# @codelex/mobile

CODELEX for iOS and Android: React Native + Expo (ADR-0002), Expo Router, Hermes, New Architecture. Since
E-1.5 slice S1: Home → PLAY NOW → a full local match vs the Beginner bot on the Skia board, behind the flag
`play_vs_bot.enabled` (bundled default **off**; Home then shows the "paused" card). The bundled lexicon index is
loaded and verified before any route mounts. Dev and playtest builds turn the flag on at build time:
`EXPO_PUBLIC_CODELEX_FLAGS=play_vs_bot.enabled=1`. Design note: `docs/architecture/notes/mobile-app-foundation.md`.
Slice S2 adds the match HUD (menu with move log, board legend and Resign), the engine score breakdown (strip chips +
sheet), the lexicon-free "Base N" preview (flag `match.live_score_preview`, default on), Shuffle and Exchange, and
the Summary (result, scores with rack adjustments, end reason, margin, best word, canonical term chips, the bot's
last rack). Flag `board.tech_squares.enabled` exists, default off, with no effect on the pinned v1 layout (AC-3).
Slice S5 adds the post-match Knowledge Card (AC-13/AC-14) behind `knowledge_card.post_match.enabled` (bundled default
**off**): term chips, the best word and "Discover the terms you played" open a bottom sheet with the term's category,
difficulty, definition (EN fallback with a tag) and up to 5 related terms, from local data only (the `.clxi` plus
`assets/lexicon/cards.json`, see the foundation note §3.3). Its events go through `src/analytics/emitter.ts`, a no-op
until the S6a recorder plugs in.

- Owner: `mobile-engineer` (consult `ux-ui-designer` for visuals, `realtime-engineer` for the protocol)
- Coverage: 80 % on lines, statements, functions and branches, read from `@codelex/config/vitest` `basePreset`
- Hand-written (the `/scaffold` generator does not support `apps/*` yet) following the package conventions.

## Identity and EAS builds

App identifier `com.codelex.app` (Android package and iOS bundle identifier), Expo owner `m67`, privacy policy URL in
`expo.extra.privacyPolicyUrl`. `eas.json` has one profile, `preview`: internal distribution, Android `.apk`, and
`play_vs_bot.enabled` turned on through `EXPO_PUBLIC_CODELEX_FLAGS` for that profile only. `eas-build-post-install`
builds the workspace dependencies and the lexicon asset on the EAS worker. `extra.eas.projectId` is set by the owner
with `eas init`. Owner steps: `docs/runbooks/android-internal-test.md`.

## Stack (pinned)

Expo SDK 57 (`expo` 57.0.26), React Native 0.86.3, React 19.2.3, Expo Router 57.0.24, Reanimated 4.5.1 +
Worklets 0.10.1, Gesture Handler 2.32.0. SDK 57 has no `newArchEnabled` or `jsEngine` switch: the New Architecture
and Hermes are the only options, so both are pinned by the SDK version. Upgrade with `expo install --fix` one SDK at a
time, never to an SDK published less than 3 days ago (`minimumReleaseAge`).

## Layout

```
src/app/            Expo Router routes only (default exports allowed here, nowhere else)
src/features/<f>/   screens and feature components (home, match: screen, sheets, rack, thinking dots, summary)
src/match/          engine-driven match model and move log, BotRunner seam (P5 §4.1, JS thread), status strip,
                    breakdown and summary presenters, useMatch
src/board/          Skia board (E-1.4 §2 contract, A-4 reversed): scene data, hit-test worklets, gestures, a11y grid
src/a11y/           reduced motion and screen-reader hooks
src/config/         feature flags (bundled defaults + build-time overrides)
src/ui/             token-only primitives (Button, Sheet)
src/i18n/           I18nProvider / useI18n over @codelex/i18n (device locale, EN fallback)
src/knowledge/      card text decoder (raw DEFLATE + base64), card model and card stack (pure)
src/features/knowledge/  Knowledge Card sheet, card hooks, category glyphs
src/lexicon/        .clxi loader (pure, injected platform source), LexiconGate / useLexicon, E-1.5 §5.10.1 error state
src/linking/        deep-link guard used by src/app/+native-intent.ts (GHSA-vcc3-ghjq-m6fr)
src/theme/          useTokens() over @codelex/design-system (OS appearance, dark default)
scripts/            prepare:lexicon, bundle-size budget and bundle-contents check (node:test)
assets/lexicon/     lexicon.clxi + lexicon.json + cards.json (card text), written by prepare:lexicon (git-ignored,
                    never edit)
jest/               Jest-only stand-ins: .clxi transformer, Node versions of expo-asset/-file-system/-crypto, Skia
                    stand-in, worklets resolver, Gesture Handler setup
e2e/                Maestro flows (S1: full match vs Beginner; S2: HUD, Resign, Summary; S5: Knowledge Card)
metro.config.cjs    Expo defaults + `clxi` asset extension (lexicon index)
bundle-budget.json  bytes per platform for the Hermes bundle, the bundled code assets and the lexicon index
bundle-forbidden-packages.json  toolchain packages that must never be bundled (audit exceptions)
```

## Commands

```bash
pnpm turbo run prepare:lexicon --filter=@codelex/mobile  # build:index + copy the .clxi asset (once, before start)
pnpm --filter @codelex/mobile start                  # Expo dev server (needs a dev build or Expo Go 57)
pnpm turbo run lint typecheck format:check test --filter=@codelex/mobile
pnpm turbo run bundle:check --filter=@codelex/mobile # expo export (Hermes bytecode + maps) + budget + contents
```

`build` is `expo export --platform android --platform ios --source-maps`: Metro plus `hermesc -O -output-source-map`
(the flags of a React Native release build) produce the Hermes bytecode bundles a store build embeds, on any Linux
host, without Xcode or the Android SDK. `bundle:check` compares them, the bundled code assets and the lexicon index to
`bundle-budget.json`, checks that each platform bundles exactly the `.clxi` named by `assets/lexicon/lexicon.json`, then
fails if a package listed in `bundle-forbidden-packages.json` is a module in either source map: that is the
proof behind the toolchain audit exceptions in `docs/security/audit-exceptions.md`. Native binaries (EAS Build), cold-start and
60 fps measurements need devices and are not part of CI yet (sprint task H1).

## Rules

1. No hard-coded user-facing strings and no literal colours in `src` (lint, E-1.4 §5.1): `t(key)` and `useTokens()`.
2. The client never decides a competitive outcome. Local vs-bot matches are scored only by `@codelex/game-engine`
   (`apply`); the app never computes a score, a validity or a bot move itself. Bots run through the `BotRunner` seam
   with plain-data requests (observation + RNG state, never the seed).
3. Lint, format and coverage rules come from `@codelex/config`; app-specific rules only add restrictions.
4. No crash SDK in the playtest build (E-1.5 Q-1/Q-7): unclean-exit flag + TestFlight / Play Console statistics.
