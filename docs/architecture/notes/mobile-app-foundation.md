# Design note — mobile app foundation (`apps/mobile`, `packages/i18n`, `packages/design-system`)

- Status: Proposed · Date: 2026-10-03 · Owner/author: mobile-engineer
- Reviewed-by: pending ux-ui-designer (§5), frontend-web-engineer (§4, owner of `packages/i18n`), lexicon-engineer
  (§3), security-engineer (§7.2)
- Sprint: `docs/sprints/2026-10-03-phase1-bots-app-foundation.md`, task A1. Unblocks H1 (device timings) and S1
  (first playable slice).
- Inputs (normative, this note never overrides them): ADR-0002 (React Native + Expo), ADR-0010 (testing),
  `docs/architecture/notes/lexicon-index.md` §3.4–§3.5 (`.clxi` build and loading),
  `docs/specs/E-1.4-design-system/design-system-v1.md` (E-1.4), `docs/specs/E-1.5-play-vs-bot/` (E-1.5: D-19
  locale, §5.10.1 corrupt-index state, §10 copy keys, Q-1/Q-7 crash reporting).
- No ADR: everything here is reversible inside ADR-0002.

## 1. Scope

A1 delivers the scaffolds only: an Expo app with one placeholder Home screen (app name from the catalog, rules-engine
version imported from `@codelex/game-engine`), the i18n package (EN/FR catalogs, typed `t`), the design-system
package (partial token set) and CI wiring (lint, typecheck, test, bundle budget). No game screen, no board, no
lexicon loading code (§3 describes it; the asset does not exist until L6).

## 2. Expo SDK and runtime pin

| Item | Pin | Why |
|---|---|---|
| Expo SDK | **57** (`expo` 57.0.26) | Latest stable. SDK 58 was published 2026-09-29, under the repo's 3-day `minimumReleaseAge`, and its first patches are still landing: upgrade in a dedicated PR once it has settled. |
| React Native / React | 0.86.3 / 19.2.3 | The versions SDK 57 is built and tested against (`expo/bundledNativeModules.json`). |
| New Architecture | **on, not optional** | Legacy architecture was removed in RN 0.82; SDK 57's config has no `newArchEnabled` switch. |
| JS engine | **Hermes, not optional** | SDK 57 has no `jsEngine` switch. `expo export` emits Hermes bytecode (`.hbc`). |
| Router | Expo Router 57.0.24 | Role stack; route files live in `src/app/`. |
| Animation / gestures | Reanimated 4.5.1 + Worklets 0.10.1, Gesture Handler 2.32.0 | Confirms E-1.4 assumption A-5. Pinned explicitly because pnpm otherwise auto-installs newer, SDK-incompatible peers. |
| Tests | jest-expo 57.0.5 (Jest 29.7), Testing Library RN 14.0.1 | Vitest cannot load the Flow-typed `react-native` sources; jest-expo mirrors Metro's resolution. |

Rules: upgrade one SDK at a time with `expo install --fix`; every native module is pinned to the SDK's
`bundledNativeModules.json` version; native code only via Expo config plugins (ADR-0002). pnpm's isolated layout works
with SDK 57 as is (no `node-linker=hoisted`); no dependency of the app needs an install script, so `strictDepBuilds`
needs no new entry. `react-dom` is a dependency only to satisfy Expo Router's web peers; it is never in the native
bundle.

Bundle identifiers, the EAS project and store accounts are not set (§7.1).

## 3. Lexicon index (`.clxi`) loading

Implements lexicon-index note §3.5 on mobile. Only the Metro part exists today (`metro.config.cjs`:
`assetExts` += `clxi`); the rest lands with L6 (copy step) and S1 (loader).

### 3.1 Copy step (pending L6)

1. `@codelex/lexicon` `build:index` (Turborepo task, cached on inputs) writes
   `packages/lexicon/dist/indexes/<lexiconVersion>/<profileId>.clxi` and `manifest.json`
   (`{ lexiconVersion, profiles: [{ id, kind, definitionHash, formatVersion, file, bytes, sha256 }] }`).
2. A mobile script `scripts/copy-lexicon.mjs` (task `prepare:lexicon`, `build` and `start` depend on it, and it
   depends on `@codelex/lexicon#build:index`) copies the bundled profile (`global-ranked` for the playtest) and a
   trimmed manifest entry to `apps/mobile/assets/lexicon/` (git-ignored: artefacts are reproducible, never
   committed). It refuses to copy when the file's sha256 differs from the manifest, and records the GADDAG flag
   (a build without GADDAG has the same version and profile but different bytes; the manifest key carries the flags).
3. `bundle-budget.json` gets a `lexiconBytes` line; the index is measured separately from code assets.

### 3.2 Load (pending S1)

At startup, behind the splash (`splash.loading`), exactly once per process:

1. Resolve the asset: `Asset.fromModule(require('../assets/lexicon/global-ranked.clxi'))` (expo-asset), then
   `downloadAsync()`, which is a no-op for embedded assets in release builds.
2. Read it into a fresh `Uint8Array` (expo-file-system `File#bytes()`): the buffer is new, so it is 8-byte aligned and
   the decoder creates zero-copy views. The loader owns it and never writes to or reuses it while the index lives
   (lexicon-index note §3.5, ownership).
3. Verify `sha256(bytes)` against the bundled manifest entry with the native digest (expo-crypto
   `digest(SHA256, bytes)`, native code, never a JS SHA-256; timed in H1).
4. `decodeLexiconIndex(bytes, { version, profileId })` from `@codelex/lexicon/index`; it validates once (CRC and
   structural invariants) and returns `Result`.
5. Any failure (asset missing, digest mismatch, any decoder `Err`) shows the E-1.5 §5.10.1 full-screen state with a
   code (`LEXICON_INDEX_MISSING`, `LEXICON_INDEX_CORRUPT`, or the decoder code such as `VERSION_MISMATCH`), "Try
   again" re-runs the load once, and there is **never partial play**: the match UI does not mount without an index.

`expo-asset`, `expo-file-system` and `expo-crypto` become direct dependencies of the app in S1 (pnpm's isolated
layout requires direct dependencies for anything the app imports). H1 measures read + digest + decode time on Hermes
and on a low-end Android device, and `has()` p99.

## 4. i18n contract (`@codelex/i18n`)

- **Catalogs:** `packages/i18n/src/catalogs/{en,fr}.json`, flat `key → ICU MessageFormat message`. EN is the
  reference; FR must have exactly the same keys and argument names (`checkCatalogs()`, run by the tests, so CI fails
  on drift). FR uses _tu_ and French typography (U+202F before `; ! ?`, U+00A0 before `:` and inside « »), checked too.
- **Keys:** dot-separated lower `snake_case` segments, `<surface>.<element>[.<variant>]` (`home.play_now`,
  `error.lexicon.code`); shared namespaces `common.*`, `bot.<id>.*`, `a11y.*`. E-1.5 §10 keys are used verbatim.
- **API:** `createTranslator(locale, { onError })` → `{ locale, direction, t }`; `t(key: MessageKey, params?)`
  where `MessageKey` is the union of EN keys (typos fail `typecheck`). `t` never throws: a key missing in FR falls
  back to EN, any other problem returns the key and calls `onError` (the app logs it in development only).
  `resolveLocale(deviceTags)` picks the first supported primary subtag, else EN (E-1.5 D-19: device locale, no
  in-app switch). `textDirection(locale)` keeps layouts RTL-ready.
- **ICU subset:** `{arg}`, `{arg, number}`, `plural` (`=N`, CLDR categories, `#`), `select`, apostrophe quoting.
  Anything else (dates, ordinals, number styles, `offset`) is rejected at parse time and added with tests when a
  spec needs it. The formatter is about 300 lines with zero dependencies; a full ICU runtime (FormatJS) would add
  a runtime plus an `Intl.PluralRules` polyfill to the bundle for features we do not use yet.
- **App integration:** `I18nProvider` (device locales via `expo-localization` `useLocales()`) and `useI18n()`.
  Lint bans JSX text and literal `accessibilityLabel`/`title`/`placeholder`/`label` strings in `apps/mobile/src`
  (E-1.4 §5.1 "no-literal-ui-strings").

### 4.1 Hermes `Intl` decision: no polyfill

Hermes implements `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.Collator` and the `toLocale*String` methods on
Android and iOS, but **not** `Intl.PluralRules` (nor `RelativeTimeFormat`, `ListFormat`, `Locale`, `DisplayNames`).
Decision: `@codelex/i18n` carries its own CLDR plural rules for the shipped locales (EN: one = `i = 1 and v = 0`;
FR: one = `i = 0,1`, many = exact millions) and never calls `Intl.PluralRules`; a property test pins parity with
`Intl.PluralRules` on Node. Numbers use `Intl.NumberFormat`, which Hermes has. No polyfill ships.

Revisit when: a new locale is added (add its rules, or adopt `@formatjs/intl-pluralrules` with data for shipped
locales only, if several locales arrive at once), or a spec needs relative times or lists. H1 confirms on a device
that `Intl.NumberFormat('fr')` emits U+202F group separators (the tests assume ICU behaviour).

## 5. Design tokens (`@codelex/design-system`)

`TOKENS_STATUS = 'partial'`: the E-1.4 §1.2 chrome colour roles (dark and light), the §1.4 system type ramp and
§1.5 `space.0..8`, with the spec values and flat camelCase keys (§1.1). `useTokens()` resolves the OS appearance
(dark when unknown). Lint bans literal colours in `apps/mobile/src`. Findings for `ux-ui-designer`:

- Light `accent.onPrimary` (#FFFFFF) on `accent.primary` (#00876A) is 4.49:1, under 4.5:1. Per assumption A-2 ("the
  contrast script decides") the package uses #00866A (4.55:1). Please confirm or pick another value in the spec.
- `border.subtle` (#2A3646 on #121923, about 1.4:1) cannot meet 3:1; the contrast check treats it as a decorative
  separator. Confirm that no state relies on it.

Pending for S1: board, tile, premium, category, mono type, radius, elevation, layout and motion tokens, the DTCG
`tokens/*.json` files with the typed build (same `Tokens` shape), and `BoardView` (E-1.4 §2), which no A1 code touches.

## 6. Quality gates

- `lint` (shared `@codelex/config` rules plus React Hooks, the UI-string and colour bans; route files may default
  export), `typecheck` (strict, bundler resolution), `format:check`, `test` (jest-expo with coverage thresholds read
  from `basePreset`, 80 %; node:test for the budget script). All run under `pnpm turbo run lint typecheck
  format:check test`.
- **Bundle budget:** `build` = `expo export --platform android --platform ios`. Metro and `hermesc` produce the
  Hermes bytecode bundles a store build embeds, on a plain Linux runner, with no Xcode or Android SDK.
  `bundle:check` compares the bundle and bundled assets per platform with `bundle-budget.json` (2026-10-03: Android
  3.82 MB bundle / 0.99 MB assets, iOS 3.61 MB / 0.02 MB; budgets about 15 % above). CI runs it as a separate step
  after the tests, so the CPU-heavy export does not slow the timed test suites. Store download size, cold start
  (< 3 s), 60 fps and drag latency need native builds and devices: H1, then a device-farm job.
- **Crash reporting:** no SDK (E-1.5 Q-1/Q-7). S1 adds the unclean-exit flag: set a "session open" marker at
  launch, clear it on a clean background or exit; at the next launch a remaining marker means an unclean exit and is
  reported with `app_start` (E-1.5 analytics). Crash-free rates come from TestFlight and Play Console.

## 7. Open items

1. **Needs a human:** bundle identifier / application id (one-way once published), Expo account and EAS project id,
   Apple Developer and Google Play accounts, signing credentials (never in the repo), TestFlight / Play internal
   track (T2). Then a first EAS development build to run on devices (H1).
2. **Dependency audit:** `node-forge` ≤ 1.4.0 (GHSA-86w9-cpqp-85rv, high, no patched release) comes in through
   `expo` → `@expo/cli`, which uses it only for local code-signing tooling (iOS signing identities, expo-updates
   manifest signing); it is not in the app bundle. Every Expo SDK depends on `@expo/cli`. Needs a `security-engineer`
   review and a product-owner decision on a time-boxed exception (`docs/security/audit-exceptions.md`); until then
   `pnpm audit --audit-level=high` fails on this branch.
3. Expo/React ESLint rules for every app (React Hooks, the UI-string and colour bans) live in `apps/mobile` for now;
   move them into `@codelex/config` when `apps/web` arrives (owner devops-sre).
4. `/scaffold apps/<name>` support in `tools/scaffold` (the generator still refuses `apps/*`).
