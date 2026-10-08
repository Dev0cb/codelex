# @codelex/golden-runner

Golden runner for the Node ↔ Hermes cross-runtime check (ADR-0016, implementing ADR-0013 §D8.2): the contracts
(sprint 4 A2: runner report, preview Diagnostics report, comparison), the pure runner core and corpus, and the
Node and Hermes CLI hosts (sprint 4 P3, first half). The CI job is devops-sre's half of P3; the app host is DG1.

- Owner: `game-engine-engineer` (consulted: `ai-engineer` for the bots suite, `mobile-engineer` for Diagnostics)
- Coverage preset: `strict` (90 %, as for `game-engine`; ADR-0016 follow-up table)
- Scaffolded by `tools/scaffold/scaffold.mjs` (`--unlisted`: the package is decided by ADR-0016 §D3 item 1 and is
  not yet in the CLAUDE.md §2 repository map).

## API

| Export                                                    | What                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `runnerReportSchema`, `parseRunnerReport(Text)`           | `runnerFormat` 1 (§D3.1). JCS subset, ≤ 1 KB `observed`, ≤ 256 KB report, no unknown keys               |
| `diagnosticsReportSchema`, `parseDiagnosticsReport(Text)` | `diagnosticsFormat` 1: preview build info, device block, runner report (`hermes-app`), H1 bench results |
| `compareReports`, `compareReportTexts`                    | §D3.2: strip `runtime` and `timings`, compare the engine's canonical bytes, name the first difference   |
| `describeComparison`                                      | One-line CI message for a comparison result                                                             |
| `checkRunnerReportSize`                                   | Canonical size of a report and whether it is within 256 KB                                              |

Canonical bytes come from `@codelex/game-engine/canonical` (the engine's own JCS serialiser); this package never
re-implements it.

## Core: `@codelex/golden-runner/core` (zod-free)

`runGoldens(corpus, host) => report` (ADR-0016 §D3 items 2–3). `host = { runtime, clock? }`: the host supplies its
runtime block and, optionally, an integer-millisecond clock for `timings` (the ADR writes `runGoldens(corpus)`; the
runtime block has to come from the host, so it is an argument). Exports: `runGoldens`, `GOLDEN_CORPUS`, `SUITES`,
`corpusDigest`, `engineRulesVersionsOf`, `canonicalJson` (re-export) and the core types. It never imports zod or
the report schemas: DG1 imports **only** this entry; parsing and comparison stay on Node.

| Suite (order)          | Corpus file(s)                                | Cases (ids)                                                              | Public APIs used                                                             |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `rng`                  | `game-engine/test/golden/rng.json`            | `<seed>/<stream>`: derived state, `next`, `int` series, shuffle          | `./rng`                                                                      |
| `sha256`               | `sha256.json`                                 | vector name                                                              | `./canonical` (`sha256Hex`, `asciiBytes`)                                    |
| `jcs`                  | `jcs.json`                                    | `cases/<name>` (text, sha256, hash16), `rejections/<name>` (error kind)  | `./canonical`                                                                |
| `scoring/v1`           | `scoring/v1/classic.json`, `inflections.json` | `GC-CL-*`, `GC-INF-*` (breakdown), `GC-CL-E*` (end result)               | `createMatch`, `observe`, `evaluateMove`, `parseState`, `apply`              |
| `replays/v1`           | `replays/v1/gc-det-01{,.log,.lexicon}.json`   | `GC-DET-01/log`, `GC-DET-01/state-hashes/<from>-<to>`, `GC-DET-01/final` | `parseActionLog`, `replay` (`recordHashes`)                                  |
| `bots/decisions-b2-r1` | `bots/test/golden/decisions-b2-r1.json`       | `fixture`, `<seed>/<actions>/<personality>` (key, budget counters)       | `chooseAction`, `actionKey`; `@codelex/lexicon/index` `.clxi` build + decode |

- **Pass rule.** Each case computes `observed` and states the golden's `expected`; it passes iff their canonical
  bytes (engine serialiser) are equal. `observed` above 1 KB is reported as `{ "sha256": … }`. A typed engine or
  bots error, or a malformed golden case, is an `error` case with a typed name (`CORPUS_MALFORMED`,
  `ACTION_REJECTED`, …), never a message.
- **No rule logic** (CLAUDE.md §1.2). Fixtures are rebuilt with public APIs: the G-LEX-SMALL stub (transcribed from
  the engine's scoring test), the GC-DET-01 frozen lexicon (from its JSON), the bots' 2,000-form synthetic `.clxi`
  and Beginner mirror positions (as in `packages/bots/test/support`). A fixture drift fails the cases on every
  runtime; it cannot make one pass.
- **End cases** run the real end path: a state with the case's scores and racks (accepted by `parseState`, tiles
  conserved by putting the rest of the bag on the board), then `RESIGN`, `PASS` until the scoreless limit, or a
  one-tile going-out move (`AI`); the going-out move's own score is taken off before comparing team scores.
- **Replays** run without the stored `stateHashes` and report the recomputed ones in chunks of 30, so a divergence
  names the action range.
- **Corpus digest.** SHA-256 of the JCS of `{ path: content }`. The golden files hold booleans, one `null` and
  non-ASCII notes, which the JCS subset rejects, so values are first mapped injectively into the subset (strings
  `s:` + `~XXXX` escapes, `b:1`/`b:0`/`n:`; see `src/core/digest.ts`). Open question to solution-architect: confirm
  this encoding or define another before device reports are collected.
- **Corpus imports.** The goldens are imported as JSON through package subpaths
  (`@codelex/game-engine/golden/*`, `@codelex/bots/golden/*`), so tsc/Node, Metro and the app embed the same files.

## Hosts (`src/host/**`, `bin/`, `scripts/`)

Node-only (or Hermes-only) modules with a narrow lint exemption (`@codelex/config` eslint,
`GOLDEN_RUNNER_HOST_FILES`): no purity allow-list and no clock bans, but `JSON.stringify` and `Math.random` stay
banned. The core never imports them.

| Host       | Command                                                                                                       | Output / exit code                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Node       | `pnpm --filter @codelex/golden-runner golden:node > node.json`                                                | canonical report on stdout; 0 = pass, 1 = verdict fail, 2 = report fails the schema     |
| Hermes CLI | `pnpm --filter @codelex/golden-runner golden:hermes:build` then `hermes .hermes-out/runner.hbc > hermes.json` | canonical report printed with `print(canonicalJson(report))`                            |
| Compare    | `pnpm --filter @codelex/golden-runner golden:compare node.json hermes.json`                                   | `describeComparison` line; 0 = equal and passing, 1 = any failure, 2 = usage/read error |

**Hermes bundle (ADR-0016 §D3 item 4).** `scripts/build-hermes.mjs` runs `expo export:embed` from `apps/mobile`
(the app's `metro.config.cjs` and `babel-preset-expo`; the command the Android release build runs) with
`--platform android --dev false --minify true` on `dist/host/hermes-main.js`, checks from the source map that no
zod or report schema module is bundled, and compiles with the `hermesc` of the `hermes-compiler` that
`react-native` resolves to from `apps/mobile`, with the Gradle release command line
`-w -emit-binary -max-diagnostic-width=80 -out runner.hbc runner.js -O -output-source-map`. Standalone Metro was
practical, so no other bundler is used. Requires `pnpm turbo run build --filter=@codelex/golden-runner` first.
The `hermes` VM itself is built from the pinned tag (`tools/hermes/hermes-pin.json`) by the CI job (devops-sre).

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/golden-runner
```

## Invariants

1. **Frozen formats.** `test/schemas/*.v1.schema.json` are the JSON Schema snapshots of `runnerFormat` 1 and
   `diagnosticsFormat` 1, protected by the "Golden immutability" job (`tools/golden/protected-paths.json`). Never
   update them in place: a change is a format bump with a new schema next to the old. A zod upgrade that only
   changes the generated JSON Schema also needs a decision (bump, or a new snapshot name with review).
2. **Bounded depth.** Parsers scan nesting iteratively before zod (≤ 64 levels, the engine serialiser's limit);
   `observed` is capped at 32 levels so a report stays valid inside the Diagnostics wrapper.
3. **JCS subset.** Every report value is a printable-ASCII string, a safe integer (not `-0`), an array or an
   object; no booleans, `null` or fractions. Timings are integers with an explicit `unit` (`ns`, `us`, `ms`).
4. **No device or user data in a runner report.** Device model, OS version and RAM class exist only in the
   Diagnostics wrapper, whose `build.profile` must be `preview`. No install id, user id or timestamp anywhere.
5. **Pure core.** Lint applies the engine determinism bans and a purity allow-list (`@codelex/game-engine` `.`,
   `./rng`, `./canonical` and the published goldens; `@codelex/bots` and its published goldens;
   `@codelex/lexicon/index`; `@codelex/config/result`; `zod`): no `Date`, `Math.random`, `Intl`, `node:*` or IO in
   shipped code. Hosts (`src/host/**`, `bin/`, `scripts/`) have the documented exemption above.
6. **Deterministic order.** Suites in `SUITES` order, cases in golden-file order; two runtimes that compute the same
   values print byte-identical reports (apart from `runtime` and `timings`).
7. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
