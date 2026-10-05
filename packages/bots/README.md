# @codelex/bots

Deterministic AI opponents. No LLM, no clock, no ambient randomness: same observation, lexicon, RNG stream,
personality and budget give a deep-equal decision. Contract: `docs/architecture/notes/bots-api.md` (B0, with the
§9.1 decisions).

- Owner: `ai-engineer` (behaviour and calibration with `game-designer`)
- Coverage preset: `strict`, 90 % on lines, statements, functions and branches (`@codelex/config/vitest`)
- Status: sprints B1–B2. Personalities `random-legal` (internal floor), `beginner` (E-1.5) and `greedy`
  (simulator yardstick). GADDAG move generation over `LexiconIndex.gaddag`, DAWG (Appel–Jacobson) fallback over
  `LexiconIndex.dawg` when the artefact omits the GADDAG section (BOT-8; same move set, P-BOT-03).

## API

| Export                         | Description                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `chooseAction(obs, ctx)`       | `Result<BotDecision, BotError>`; synchronous, consumes only `ctx.rng` (BOT-1)               |
| `BotContext`                   | `{ lexicon, rng, personality, budget }`; the host derives `rng` from `bot:<seat>:<n>`       |
| `BotDecision`                  | `{ action, nodesUsed, candidatesEvaluated, budgetExhausted }`; `action` is canonical        |
| `BotError`                     | `NOT_A_SEAT` → `MATCH_OVER` → `NOT_ON_TURN` → `LEXICON_MISMATCH` → `INVALID_BUDGET`         |
| `PERSONALITIES`, `BOT_VERSION` | Frozen integer-only personality table (§5.1) and the behaviour version (bump on any change) |
| `actionKey`, `compareKeys`     | Canonical action key (`P` + `RRCCt` per tile, `X` + tiles, `S`) and its code-unit order     |

Host recipe (simulator, app, server):

```ts
const obs = observe(state, seat);
const rng = deriveRng(seed, `bot:${seat}:${obs.actionCount}`);
const decision = chooseAction(obs, {
  lexicon,
  rng,
  personality: 'beginner',
  budget: PERSONALITIES.beginner.budget,
});
```

Pipeline (bots-api §4.1): guards → board view (anchors, `crossCheck` masks, outside the node budget) → GADDAG
or DAWG generation (node = one successful transition, separator included; stops at `maxNodes`, best-so-far) → policy
(`random-legal`: uniform pick in key order + one `evaluateMove`; `beginner`/`greedy`: vocabulary filter,
attention sample or cap, `evaluateMove`, rank by total then key, missed Full Stack, weighted top-N) → rule-correct
fallback (EXCHANGE of the rack minus blanks if the bag holds ≥ 7, else PASS; never RESIGN). Scores come only from
`evaluateMove`.

An index without a GADDAG (a `.clxi` built with `gaddag: false`, e.g. a mobile build over the size gate) uses the
DAWG path: the same candidates in a different order, so the same decision whenever no budget drops work
(P-BOT-03). Q-A2 numbers (nodes and Node time, GADDAG vs DAWG): bots-api §6.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/bots
pnpm --filter @codelex/bots bench   # Q-A2 measurement (non-gating, several minutes)
pnpm --filter @codelex/bots simulate -- --mirror 1000 --pair 500   # B2 simulator (non-gating)
```

## Simulator (B2)

`sim/` holds the B2 simulator: seeded bot-vs-bot Classic matches on the real lexicon (`global-ranked`, built as a
`.clxi` with the GADDAG section and decoded) plus the E-1.7 AC-20 variant without inflections. The simulator is
the host (BOT-2): it owns the state and the seeds, gives each bot `observe(state, seat)` and
`deriveRng(seed, "bot:<seat>:<n>")`, applies every decision and replays every match (`replay` with per-action
state hashes). Match seeds derive from a master seed (`sim-match:<pairing>:<i>`); personalities swap seats every
other match. Statistics are integers (basis points, tenths, Wilson 95 % intervals with an integer square root):
the determinism lint covers `sim/` too, so no clock, no float, no `JSON.stringify` (an explicit JSON writer is
used). `simulate` compiles `src` + `sim` with `tsconfig.sim.json` into `dist/simulator` and runs
`dist/simulator/sim/cli.js`; outputs go to `sim-results/` (git-ignored) unless `--out`/`--markdown` say
otherwise. Wall time is measured by the caller (`time pnpm … simulate`). Readouts: `docs/game/sim/`.

### Rules versions and the V1 balance check (B3)

- **Rules by flag (T-2).** `--rules v1` (default) or `--rules v2 --candidate tb-0-2-4-8|tb-0-3-6-12`
  (`--layout classic-v1` for the DW-start diagnostic). The draft opt-in (`@codelex/game-engine/draft`) is
  imported only in `sim/rules.ts`. One draft context per variant goes to `createMatch`, `apply`, `replay` and the
  bots (`BotContext.draft`, passed to every `evaluateMove`). Each variant's report records version, status,
  candidate, layout, letters, term bonus and `rulesDigest` (ADR-0014 §D4). The simulator never exports logs.
- **Yardstick.** `greedy-matched` is `greedy` with `maxDifficultyRank` 1 (BG-2a). It is set through
  `BotContext.data`, a simulator-only override with no new public id (bots-api §5.4 V2-5).
- **Metrics.** C-10 (R-TURN-004 endings with bag ≥ 7), C-11 (tiles played, mean with a 95 % CI), the bag-at-end
  split 0 / 1–6 / ≥ 7, matches with a pass, and C-05 with a delta-method CI (safe integers, conservative).
  Also engine refusals per bot (`BotDecision.candidatesRefused`), the I-2 signal; a voluntary exchange is never
  a refusal. The C-11 CI is bounded by the letter table's tile count.
- **§1.3 exemption.** A draft (v2) run outside the registered suite is capped at 100 matches per pairing. A run
  over the cap fails with a hard error before any match is played.
- **`--suite balance-check`.** Runs the pre-registered suite of `docs/specs/E-1.6-balance/v2-balance-check.md`
  (`sim/balance-check.ts`): variants, fixed pairing indices 0–5, seed and counts. `sim/readout.ts` then emits every
  §3.4 criterion with its verdict, plus I-1..I-3 and the §5.1 decision. Flags: `--primary strategist|greedy`
  (`greedy` is the §5.2 path), `--diagnostics on|off`, `--variants` (job split), and
  `--code-commit`/`--lexicon-commit`/`--prereg-blob`, and `--lexicon-version`/`--definition-hash` (§4.3
  values, compared by I-3).
  - A run with another seed or other counts, or with missing commits, is INVALID by I-3. A smoke run therefore
    never yields a decision, and an INVALID run shows no per-variant pass.
  - `BOT_VERSION` must be 2 with Strategist. On the greedy path it may be 1 or 2 (§5.2 clarification of
    2026-10-05), and the decision is always labelled provisional.
  - Results record the §6 run fields: engineRulesVersions, Strategist budget, lexicon, and wall time (supplied by
    the workflow).
- **Split jobs (§5.3-2).** `pnpm --filter @codelex/bots readout -- --merge a.json b.json … [--wall-time-s n]`
  (`sim/merge.ts`, inputs parsed with zod).
  - It checks that the inputs share the seed, the commits, the pre-registration blob, `BOT_VERSION`, the primary
    bot and the Strategist budget.
  - It rejects duplicate variants and requires `v1`, `v2-3612` and `v2-248`.
  - It then writes the single readout.

```bash
pnpm --filter @codelex/bots simulate -- --rules v2 --candidate tb-0-3-6-12 --mirror 20 --pair 10
pnpm --filter @codelex/bots simulate -- --suite balance-check --primary greedy --mirror 10 --pair 10   # smoke
```

## Tests

- `src/**/*.test.ts`: units and properties next to the code (generation soundness and brute-force completeness,
  budgets, error order, determinism, fallback, Beginner weighting on crafted positions).
- `test/matches.test.ts`: full matches through `createMatch`/`apply` on the real lexicon, a 2,000-form synthetic
  lexicon and a tiny one (P-BOT-01, P-BOT-07). `test/golden.test.ts`: 20 positions × 3 personalities pinned per
  `BOT_VERSION` on the synthetic fixture. `test/purity.test.ts`: source scan backing the lint rule.
- `test/support/lexicons.ts`: fixtures use the index's own automata, from the reference index (tries) or a built
  and decoded `.clxi` artefact (minimal automata); `gaddag: false` selects the DAWG path.
- `sim/simulate.test.ts`: simulator smoke test (statistics, JSON writer, options, an 8-match suite on the real
  lexicon variants with replay and determinism checks). The ≥ 1,000-match run is never part of `pnpm test`.
  `sim/v2.test.ts`: v1/v2 rules selection, the yardstick, the new metrics, the §1.3 cap, and the V1 readout's
  decision rules on synthetic reports (fixtures in `test/support/sim-reports.ts`). `sim/merge.test.ts`: the
  merge and each rejection. `sim/stats.test.ts`: the integer mean and ratio CIs. `src/context.test.ts`: `ctx.draft` and
  `ctx.data` plumbing.
- `test/real-lexicon-matches.test.ts`: 250 full matches (1v1, 2v2, FFA 3/4; all personalities) on the real
  `global-ranked` index and the real `classic-v1` layout: every match ends, conserves tiles, replays to identical
  hashes. `test/full/real-lexicon-1000.full.ts`: the same sequence at 1,000 matches, results pinned in
  `test/full/results/` (`pnpm test:full`, about 40 s; `-u` re-records). Not part of `pnpm test`.
- fast-check runs with a fixed global seed (`test/setup.ts`).

## Invariants

1. **Purity (BOT-2).** `src/` never imports `MatchState`, `apply`, `createMatch`, `replay`, `parseState`,
   `serializeState`, `stateHash`, `observe` or any seed/stream derivation or RNG constructor
   (`@typescript-eslint/no-restricted-imports` in `eslint.config.js`, plus `test/purity.test.ts`). The
   determinism preset of `@codelex/config` bans clocks, `Math.random`, floats, async and unordered comparisons.
2. **No module state.** Scratch arrays are allocated per call.
3. **Integers only** in personality data and ranking; ties broken by the canonical key.
4. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
