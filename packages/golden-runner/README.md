# @codelex/golden-runner

Golden runner for the Node ↔ Hermes cross-runtime check (ADR-0016, implementing ADR-0013 §D8.2). This release
holds the **contracts only** (sprint 4 task A2): the runner report, the preview Diagnostics report and the
comparison. The runner core (`runGoldens`) and the Node, Hermes CLI and app hosts follow in the next task.

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

## Notes for P3 and DG1 (not implemented here)

- **Hermes host output:** print `canonicalJson(report)` from `@codelex/game-engine/canonical`, not
  `JSON.stringify` (ADR-0013 §D4.2), so both hosts emit canonical bytes.
- **App bundle:** DG1 must import a separate core entry (the runner core and corpus only), so that zod and these
  schemas never reach the app bundle; parsing and comparison stay on Node.
- **Runtimes:** `compareReports` expects a `node` reference and a `hermes-cli`/`hermes-app` candidate by default;
  any other pair (e.g. CLI against device) must be requested with `{ expect }`.

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
   `./rng`, `./canonical`; `@codelex/bots`; `@codelex/config/result`; `zod`): no `Date`, `Math.random`, `Intl`,
   `node:*` or IO in shipped code. A Node-only host module, when added, gets its own documented lint exemption.
6. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
