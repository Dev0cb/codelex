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

| Item                 | Pin                                                        | Why                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo SDK             | **57** (`expo` 57.0.26)                                    | Latest stable. SDK 58 was published 2026-09-29, under the repo's 3-day `minimumReleaseAge`, and its first patches are still landing: upgrade in a dedicated PR once it has settled. |
| React Native / React | 0.86.3 / 19.2.3                                            | The versions SDK 57 is built and tested against (`expo/bundledNativeModules.json`).                                                                                                 |
| New Architecture     | **on, not optional**                                       | Legacy architecture was removed in RN 0.82; SDK 57's config has no `newArchEnabled` switch.                                                                                         |
| JS engine            | **Hermes, not optional**                                   | SDK 57 has no `jsEngine` switch. `expo export` emits Hermes bytecode (`.hbc`).                                                                                                      |
| Router               | Expo Router 57.0.24                                        | Role stack; route files live in `src/app/`.                                                                                                                                         |
| Animation / gestures | Reanimated 4.5.1 + Worklets 0.10.1, Gesture Handler 2.32.0 | Confirms E-1.4 assumption A-5. Pinned explicitly because pnpm otherwise auto-installs newer, SDK-incompatible peers.                                                                |
| Tests                | jest-expo 57.0.5 (Jest 29.7), Testing Library RN 14.0.1    | Vitest cannot load the Flow-typed `react-native` sources; jest-expo mirrors Metro's resolution.                                                                                     |

Rules: upgrade one SDK at a time with `expo install --fix`; every native module is pinned to the SDK's
`bundledNativeModules.json` version; native code only via Expo config plugins (ADR-0002). pnpm's isolated layout works
with SDK 57 as is (no `node-linker=hoisted`); no dependency of the app needs an install script, so `strictDepBuilds`
needs no new entry. `react-dom` is a dependency only to satisfy Expo Router's web peers; it is never in the native
bundle.

Bundle identifiers, the EAS project and store accounts are not set (§7.1).

### 2.1 SDK upgrade checklist

Run in the dedicated SDK upgrade PR, and record the result of each step in its body.

1. `expo install --fix`; every native module at its `bundledNativeModules.json` version; update the table above.
2. **Re-pin the Hermes VM (ADR-0016 §D6).** Read `sdks/.hermesv1version` from the new `react-native` and the
   `hermes-compiler` version from `pnpm-lock.yaml`; resolve the tag to its commit (`git ls-remote --tags`) and
   check that it equals the `hermes-compiler` npm `gitHead`; update the Hermes pin file (ADR-0016 §D2.1); let the
   "Hermes goldens" job build the new VM (cold cache) and pass; record the cold build time. The job fails until the
   pin matches.
3. Re-check the dependency-audit exceptions that name an SDK upgrade (§7.2, `docs/security/audit-exceptions.md`).
4. `bundle:check` green; state the bundle size delta.
5. Re-run the device Diagnostics runner (ADR-0016 §D4) on a preview build before the next playtest build ships.

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
  | -------- | ------------------------- | ------------------------------ | -------------------------- |
  | Android  | 3,762,936 / 4,330,000 B   | 989,294 / 1,140,000 B          | 283,672 / 550,000 B        |
  | iOS      | 3,580,028 / 4,120,000 B   | 23,136 / 27,000 B              | 283,672 / 550,000 B        |

  **Bundle budget raise, 2026-10-06 (E-1.5 S1, PR #73): approved by the product owner in session.** Skia
  (`@shopify/react-native-skia` 2.6.2 plus `react-reconciler`) costs about 454 KB of Hermes bytecode per platform
  (android +454,428 B, ios +454,784 B measured on the import alone). The full S1 slice brings the bundle from
  3,219,028 to 3,762,936 B on android and from 3,035,296 to 3,580,028 B on iOS. That exceeded the old limits
  (3,700,000 / 3,490,000 B). The new limits are about 15 % above the S1 numbers, the same policy as before. Follow-up
  (devops-sre): run a trial of Expo/Metro tree shaking, which Metro does not do today; Skia's index pulls in Skottie,
  the web shims and the animation helpers. Tighten `bundleBytes` back toward 15 % above the measured result if bytes
  are recovered.

  Bundle baseline 2026-10-06 (S1, see above); code-asset and lexicon baselines 2026-10-03, SDK 57, with the lexicon
  loader. History: the first A1 export (3.82 / 3.61 MB) had no
  `--source-maps`; with it `hermesc` runs with the release flags and the bytecode is about 700 KB smaller (3.11 /
  2.93 MB); the loader (`@codelex/lexicon/index` decoder, expo-asset, expo-file-system, expo-crypto) then adds about
  105 KB per platform. Bundle and code-asset limits are about 15 % above the baseline (the earlier limits had become
  about 40 % loose). `lexiconBytes` is not a 15 % margin but the absolute cap of the lexicon-index §5.1 size gate
  (550,000 B at any form count; 1,501 forms and 283,672 B today), which `prepare:lexicon` enforces too: the corpus
  is planned to grow to that size, and the step fails before the bundle does. Sprint 3 (P7) restated the gate above
  2,000 forms without moving the cap: f1 also needs ≤ 215 B/form and ≤ 2,550 forms. The pre-agreed f0 switch rule
  (`BUNDLED_FLAGS = 0` when f1 fails a gate, f0 passes and DAWG generation is ≤ 1.5× GADDAG time) is in §5.1 of that
  note.

- **Crash reporting:** no SDK (E-1.5 Q-1/Q-7, Q-15). Slice S6a adds the unclean-exit flag: the "session open"
  marker (`session.open` in the data directory, TM-03) is always written at launch; before the first `active` only
  `background` removes it (a boot crash through iOS `inactive` still counts); after that it is written whenever
  `AppState` becomes `active` and removed whenever it becomes `background` or `inactive`. At the next cold start a
  remaining marker means the previous process died user-facing, reported as `app_opened.previous_exit_unclean`
  (E-1.5 analytics). A background OS kill is not unclean (OQ-SP2-4, sprint 4 D1). Pure decisions, the S6a contract
  (read `AppState.currentState` in the same tick as subscribing) and tests: `src/analytics/session-marker.ts`. Crash-free rates also come from TestFlight and Play Console.
- **Analytics and export contracts (sprint 4 D1).** Event schemas in `src/analytics/events.ts` (zod/mini, frozen
  against `docs/standards/ANALYTICS_EVENTS.md` by `catalogue.test.ts`); export envelopes `exportFormat: 1` in
  `src/export/` (`playtest-data.ts` for S6c, `match-log.ts` for S6d, TM-04). The analytics modules and
  `export/{common,playtest-data}.ts` import only `zod/mini` and siblings with `.ts` specifiers
  (`allowImportingTsExtensions`), so plain Node ≥ 22.18 loads them (`scripts/analytics-contracts.test.mjs`) for the
  readout and the TM-08 import. No app code imports them yet, so the bundle is unchanged until S6a.
- **On-device match data (E-1.5 S3, threat model `e-1.5-s1-persistence-match-log` TM-01..TM-03).** No new
  dependency: expo-file-system (already used by the lexicon loader) writes to `<documents>/codelex-data`
  (`src/persistence/device-fs.ts`): internal storage on Android, the sandbox `Documents` folder on iOS (not shown in
  the Files app). Files: `current.log` (framed records, the Q7 source of truth), `current.snap` (cache),
  `last.log` (last finished match), `terms.seen` ("New to you"), `resume.guard` (crash counter). No time, identifier
  or PII in any of them. Writes are synchronous and survive a process kill; expo-file-system has no fsync, so after
  a power loss the torn-tail rule applies (a torn last record is dropped; this residual is accepted for Phase 1
  casual play, threat model §7.1). Reads never create the directory, so a build that never saved a match writes
  nothing. Resume is one `apply` pass over the log (about 9 ms for 100 actions on Node; device p95 ≤ 300 ms is an
  H1 target). The S6 install id and analytics queue must live in the same directory (TM-03).
  Bundle after S3 (2026-10-06): android 3,816,616 / 4,330,000 B (88.1 %), iOS 3,633,836 / 4,120,000 B (88.2 %);
  limits unchanged.
- **Backups (TM-03).** `android.allowBackup: false` in `app.json`, plus the local config plugin
  `plugins/with-backup-exclusion.cjs`: `fullBackupContent="false"` and data-extraction rules that exclude every
  domain from cloud backup and device-to-device transfer (Android 12+ ignores `allowBackup` for transfers), and on
  iOS an AppDelegate hook that sets `isExcludedFromBackup` on `<Documents>/codelex-data` at every launch, before any
  JavaScript runs. Deviation from TM-03's wording: the directory is under `Documents`, not Application Support,
  because expo-file-system exposes no Application Support path; the exclusion attribute gives the same result.
  Verified by `expo prebuild` and `src/persistence/backup-exclusion.test.ts`; the on-device check (an `adb` backup
  and an iCloud backup hold no app data, a reinstall starts empty) is a release-checklist item for H1.

## 7. Open items

1. **Needs a human:** bundle identifier / application id (one-way once published), Expo account and EAS project id,
   Apple Developer and Google Play accounts, signing credentials (never in the repo), TestFlight / Play internal
   track (T2). Then a first EAS development build to run on devices (H1).
2. **Dependency audit:** `node-forge` (GHSA-86w9-cpqp-85rv) and, since 2026-10-05, `braces`/`micromatch`
   (GHSA-vfj7-8cjw-p6xm) are class-T exceptions proven absent from the bundles by `bundle:check`; `uuid`
   (GHSA-w5hq-g745-h8pq, toolchain only via `xcode`) is fixed by the `xcode>uuid` override; `decode-uri-component` (GHSA-vcc3-ghjq-m6fr, moderate, in both bundles via `expo-router` >
   `query-string` 7) is mitigated by the deep-link guard in `src/app/+native-intent.ts` because the patched release
   is ESM-only and cannot replace it (`docs/security/audit-exceptions.md`). Re-check both at every SDK upgrade.
3. Expo/React ESLint rules for every app (React Hooks, the UI-string and colour bans) live in `apps/mobile` for now;
   move them into `@codelex/config` when `apps/web` arrives (owner devops-sre).
4. `/scaffold apps/<name>` support in `tools/scaffold` (the generator still refuses `apps/*`).
