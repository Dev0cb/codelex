# @codelex/bots

Deterministic AI opponents. No LLM, no clock, no ambient randomness: same observation, lexicon, RNG stream,
personality and budget give a deep-equal decision. Contract: `docs/architecture/notes/bots-api.md` (B0, with the
§9.1 decisions).

- Owner: `ai-engineer` (behaviour and calibration with `game-designer`)
- Coverage preset: `strict`, 90 % on lines, statements, functions and branches (`@codelex/config/vitest`)
- Status: sprints B1–B2, B4 (`BOT_VERSION` 2). Personalities `random-legal` (internal floor), `beginner` (E-1.5),
  `strategist` (second playable rung, `docs/specs/E-1.3-bots/strategist.md`) and `greedy` (simulator yardstick). GADDAG move generation over `LexiconIndex.gaddag`, DAWG (Appel–Jacobson) fallback over
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
`evaluateMove`. Generation deduplicates with a packed integer signature; canonical keys are built only for the
candidates a policy keeps.

`strategist` (spec S-1..S-5): vocabulary filter (rank ≤ 2), deterministic overflow shortlist by attention key,
utility `U = 10 · total + L + C + D` in tenths of a point (leave, chain, lane denial while leading), a voluntary
EXCHANGE of `rack − K*` when X-1..X-5 hold (decided before the draw), then one weighted draw over the top 4 by `U`.
With no word it exchanges `rack − K*` (≥ 1 tile) when the bag holds ≥ 7, else passes.

## `BOT_VERSION` 2 data

| Personality              | Budget (nodes / candidates) | Notes                                                                      |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------- |
| `beginner`               | 70,000 / 300                | `topWeights` `[16, 6, 2, 1]`; BG-5 0.00 % on batch 3 (no fallback)         |
| `strategist`             | 70,000 / 500, both automata | rank 2, `topWeights` `[10, 6, 3, 1]`, tuned data in `src/personalities.ts` |
| `greedy`, `random-legal` | unchanged                   | simulator only                                                             |

B4 readout: `docs/game/sim/2026-10-b4-strategist/readout.md`.

## Kill switch `bots.strategist.enabled` (host-side flag)

The package knows nothing about flags: `chooseAction` always accepts `personality: 'strategist'`. The flag is owned
by the app (and later the server) and has this contract (spec AC-10, § Flags & rollout):

- **Off:** the opponent selector does not offer Strategist for **new** matches. Default off until B4 passes
  AC-8/AC-9 and S4 lands; on in the playtest build.
- **In-progress matches** against Strategist always finish and resume with Strategist whatever the flag says
  (E-1.5 AC-9): the host keeps calling `chooseAction` with the personality pinned in the match, so turning the
  flag off never strands a match or changes a decision (BOT-1: same stream, same move).
- Analytics: `bot_match_started.bot_personality = strategist`, `bot_version = 2`; no new event or property.
- Kill triggers: an illegal action or a non-determinism report, compute p95 > 4 s on the reference device, a crash
  attributable to the bot, or a human win-rate CI entirely below 10 %.

An index without a GADDAG (a `.clxi` built with `gaddag: false`, e.g. a mobile build over the size gate) uses the
DAWG path: the same candidates in a different order, so the same decision whenever no budget drops work
(P-BOT-03). Q-A2 numbers (nodes and Node time, GADDAG vs DAWG): bots-api §6.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/bots
pnpm --filter @codelex/bots bench   # Q-A2 measurement (non-gating, several minutes)
pnpm --filter @codelex/bots simulate -- --mirror 1000 --pair 500   # B2 simulator (non-gating)
pnpm --filter @codelex/bots simulate:b4 -- --job st1b --recheck 100   # B4 ST-x job (non-gating, rules v1)
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

## Tests

- `src/**/*.test.ts`: units and properties next to the code (generation soundness and brute-force completeness,
  budgets, error order, determinism, fallback, Beginner weighting on crafted positions).
- `test/matches.test.ts`: full matches through `createMatch`/`apply` on the real lexicon, a 2,000-form synthetic
  lexicon and a tiny one (P-BOT-01, P-BOT-07). `test/golden.test.ts`: 20 positions × 4 personalities pinned per
  (`BOT_VERSION`, `engineRulesVersion`) in `test/golden/decisions-b<V>-r<R>.json`, computed on the synthetic
  fixture built as the shipped f1 `.clxi`; positions are chosen so that no cap binds for any personality
  (`capBoundDecisions` 0), and f0 must decide the same on every one. `decisions-v1.json` is the frozen (1, 1) record
  (SHA-256 pinned in the test), no
  longer executed. Published golden files are never edited: a change needs a version bump and a new file.
- `src/policy/strategist.test.ts`, `src/strategy/*.test.ts`: Strategist terms on crafted positions (leave, chain,
  lane denial, X-1..X-5 boundaries, forced keep, overflow shortlist, the single draw, P-BOT-09). `test/purity.test.ts`: source scan backing the lint rule.
- `test/support/lexicons.ts`: fixtures use the index's own automata, from the reference index (tries) or a built
  and decoded `.clxi` artefact (minimal automata); `gaddag: false` selects the DAWG path.
- `sim/simulate.test.ts`: simulator smoke test (statistics, JSON writer, options, an 8-match suite on the real
  lexicon variants with replay and determinism checks). The ≥ 1,000-match run is never part of `pnpm test`.
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
