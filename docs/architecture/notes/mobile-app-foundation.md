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

A1 delivers the scaffolds: an Expo app with one placeholder Home screen (app name from the catalog, rules-engine
version imported from `@codelex/game-engine`, `lexiconVersion` of the loaded index), the i18n package (EN/FR catalogs,
typed `t`), the design-system package (partial token set), CI wiring (lint, typecheck, test, bundle budget) and, once
L6 landed, the bundled `.clxi` lexicon index loaded and verified at startup (§3). No game screen, no board.

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

Implements lexicon-index note §3.4 (consumer side) and §3.5 (loading) on mobile. Done in sprint A1 after L6.

### 3.1 Copy step (`prepare:lexicon`)

1. `@codelex/lexicon` `build:index` (Turborepo task, cached on inputs) writes, under
   `packages/lexicon/dist/indexes/`: `<lexiconVersion>/<profileId>.f<flags>.clxi` (`f1` with the GADDAG, `f0`
   without), `<lexiconVersion>/manifest.json` (`{ lexiconVersion, profiles: [{ id, kind, definitionHash,
   formatVersion, flags, gaddag, file, bytes, sha256 }] }`) and `current.json` (`{ lexiconVersion, manifest }`), the
   stable entry point.
2. The Turborepo task `@codelex/mobile#prepare:lexicon` (`apps/mobile/turbo.json`; `dependsOn:
   ["@codelex/lexicon#build:index"]`, outputs `assets/lexicon/**`) runs `scripts/prepare-lexicon.mjs`. It calls
   `resolveIndexArtefact({ profileId: 'global-ranked', flags: 1 })` from `@codelex/lexicon/indexes`, which follows
   `current.json` and refuses (typed `IndexArtefactError`) a missing build, a missing profile or a file whose size or
   sha256 differs from the manifest. The flags are explicit (`BUNDLED_FLAGS` in `scripts/lexicon-asset.mjs`): `f1`,
   because the bots generate moves with the GADDAG, as long as the artefact fits the `lexiconBytes` budget (3. below);
   above it the step fails and switching to `f0` (bots fall back to the DAWG, about 2× slower) or to CDN delivery is a
   reviewed decision, never automatic.
3. It writes, under stable names so Metro can resolve them statically (write then rename, never a truncated file):
   - `apps/mobile/assets/lexicon/lexicon.clxi`: the artefact bytes (bundled as a binary asset, Metro `assetExts` +=
     `clxi`);
   - `apps/mobile/assets/lexicon/lexicon.json`: the descriptor `{ lexiconVersion, profileId, flags, sha256, bytes }`
     (inlined in the JS bundle). On 2026-10-03: `4fa5884050b4ea53`, `global-ranked`, `1`,
     `45ede0e8…95e16f5`, `283672`.

   Both are git-ignored (`.gitignore`, `.prettierignore`): reproducible build outputs, never committed.
4. `build`, `test`, `lint` and `typecheck` depend on `prepare:lexicon` (the app imports the descriptor and the
   asset); `bundle:check` depends on `build`. Locally, run `pnpm turbo run prepare:lexicon --filter=@codelex/mobile`
   once before `pnpm --filter @codelex/mobile start`.
5. `bundle-budget.json` has a `lexiconBytes` line per platform (§6); the index is measured separately from code
   assets, and `bundle:check` also proves that each platform bundles exactly one `.clxi` with the descriptor's size
   and sha256.

### 3.2 Load (runtime)

`src/lexicon/`: `load-lexicon.ts` holds the logic, pure and unit-tested: the platform side is an injected
`LexiconSource` (`descriptor`, `readBytes()`, `sha256Hex(bytes)`). `bundled-lexicon-source.ts` is the device
implementation. `lexicon-gate.tsx` (`LexiconGate`, `useLexicon()`) wraps every route in `src/app/_layout.tsx`, behind
the splash copy (`splash.loading`); a successful load is cached per process, a failure is not.

1. Parse the descriptor (shape, 16-hex `lexiconVersion`, profile id, flags, 64-hex sha256, positive size); anything
   else is `LEXICON_INDEX_MISSING`.
2. Resolve the asset: `Asset.fromModule(<lexicon.clxi module>)` (expo-asset), then `downloadAsync()`, which is a no-op
   for embedded assets in release builds; no `localUri` or a read error is `LEXICON_INDEX_MISSING`.
3. Read it into a fresh `Uint8Array` (expo-file-system `new File(localUri).bytes()`): the buffer is new, so it is
   8-byte aligned and the decoder creates zero-copy views. The loader owns it and never writes to or reuses it while
   the index lives (lexicon-index note §3.5, ownership).
4. Check the size, then `sha256(bytes)` with the native digest (expo-crypto `digest(SHA256, bytes)`, never a JS
   SHA-256; timed in H1) against the descriptor; a difference is `LEXICON_INDEX_CORRUPT`.
5. `decodeLexiconIndex(bytes, { version, profileId })` from `@codelex/lexicon/index` (descriptor values); it validates
   once (CRC and structural invariants). Its error code is shown as is (`VERSION_MISMATCH`, `PROFILE_MISMATCH`,
   `CORRUPT`, ...). GADDAG presence must match flags bit 0, else `LEXICON_INDEX_CORRUPT`.
6. Any failure shows the E-1.5 §5.10.1 full-screen state (`error.lexicon.*` copy, the code, "Try again" re-runs the
   load once) and there is **never partial play**: no route mounts without an index. The icon and "Share diagnostics"
   come with S1 (icon set, app version).

`expo-asset` 57.0.18, `expo-file-system` 57.0.7 and `expo-crypto` 57.0.3 are direct, exactly pinned dependencies (the
SDK 57 `bundledNativeModules.json` versions; all older than `minimumReleaseAge`). Tests: `load-lexicon.test.ts`
(success, sha mismatch, tampered bytes, truncated asset, decoder error, version and profile mismatch, flags
mismatch, unreadable asset, malformed descriptors), `lexicon-gate.test.tsx` (splash, error state EN/FR, retry, load
once), `home-screen.test.tsx` and `routes.test.tsx` (Home shows the loaded `lexiconVersion`). Under Jest a `.clxi`
import yields its path and expo-asset, expo-file-system and expo-crypto run on Node stand-ins (`apps/mobile/jest/`), so
the tests verify the very bytes `prepare:lexicon` generated. H1 measures read + digest + decode time on Hermes and on
a low-end Android device, and `has()` p99.

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
- **Bundle budget:** `build` = `expo export --platform android --platform ios --source-maps`. Metro and `hermesc`
  produce the Hermes bytecode bundles a store build embeds, on a plain Linux runner, with no Xcode or Android SDK.
  `bundle:check` compares, per platform, the bundle, the bundled code assets and the `.clxi` lexicon index
  (`lexiconBytes`, its own line) with `bundle-budget.json`, checks that the bundled index is the descriptor's artefact
  (§3.1), then runs the forbidden-packages source-map check. CI runs it as a separate step after the tests, so the
  CPU-heavy export does not slow the timed test suites. Store download size, cold start (< 3 s), 60 fps and drag
  latency need native builds and devices: H1, then a device-farm job.

  | Platform | Bundle (baseline / limit) | Code assets (baseline / limit) | Lexicon (baseline / limit) |
  |---|---|---|---|
  | Android | 3,214,516 / 3,700,000 B | 989,294 / 1,140,000 B | 283,672 / 550,000 B |
  | iOS | 3,030,524 / 3,490,000 B | 23,136 / 27,000 B | 283,672 / 550,000 B |

  Baseline 2026-10-03, SDK 57, with the lexicon loader. History: the first A1 export (3.82 / 3.61 MB) had no
  `--source-maps`; with it `hermesc` runs with the release flags and the bytecode is about 700 KB smaller (3.11 /
  2.93 MB); the loader (`@codelex/lexicon/index` decoder, expo-asset, expo-file-system, expo-crypto) then adds about
  105 KB per platform. Bundle and code-asset limits are about 15 % above the baseline (the earlier limits had become
  about 40 % loose). `lexiconBytes` is not a 15 % margin but the absolute cap of the lexicon-index §5.1 size gate
  (550,000 B at any form count; 1,501 forms and 283,672 B today), which `prepare:lexicon` enforces too: the corpus
  is planned to grow to that size, and the step fails before the bundle does. Sprint 3 (P7) restated the gate above
  2,000 forms without moving the cap: f1 also needs ≤ 215 B/form and ≤ 2,550 forms. The pre-agreed f0 switch rule
  (`BUNDLED_FLAGS = 0` when f1 fails a gate, f0 passes and DAWG generation is ≤ 1.5× GADDAG time) is in §5.1 of that
  note.
- **Crash reporting:** no SDK (E-1.5 Q-1/Q-7). S1 adds the unclean-exit flag: set a "session open" marker at
  launch, clear it on a clean background or exit; at the next launch a remaining marker means an unclean exit and is
  reported with `app_start` (E-1.5 analytics). Crash-free rates come from TestFlight and Play Console.

## 7. Open items

1. **Needs a human:** bundle identifier / application id (one-way once published), Expo account and EAS project id,
   Apple Developer and Google Play accounts, signing credentials (never in the repo), TestFlight / Play internal
   track (T2). Then a first EAS development build to run on devices (H1).
2. **Dependency audit:** `node-forge` (GHSA-86w9-cpqp-85rv) is a class-T exception proven absent from the bundles by
   `bundle:check`; `decode-uri-component` (GHSA-vcc3-ghjq-m6fr, moderate, in both bundles via `expo-router` >
   `query-string` 7) is mitigated by the deep-link guard in `src/app/+native-intent.ts` because the patched release
   is ESM-only and cannot replace it (`docs/security/audit-exceptions.md`). Re-check both at every SDK upgrade.
3. Expo/React ESLint rules for every app (React Hooks, the UI-string and colour bans) live in `apps/mobile` for now;
   move them into `@codelex/config` when `apps/web` arrives (owner devops-sre).
4. `/scaffold apps/<name>` support in `tools/scaffold` (the generator still refuses `apps/*`).
