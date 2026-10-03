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
```

## Tests

- `src/**/*.test.ts`: units and properties next to the code (generation soundness and brute-force completeness,
  budgets, error order, determinism, fallback, Beginner weighting on crafted positions).
- `test/matches.test.ts`: full matches through `createMatch`/`apply` on the real lexicon, a 2,000-form synthetic
  lexicon and a tiny one (P-BOT-01, P-BOT-07). `test/golden.test.ts`: 20 positions × 3 personalities pinned per
  `BOT_VERSION` on the synthetic fixture. `test/purity.test.ts`: source scan backing the lint rule.
- `test/support/lexicons.ts`: fixtures use the index's own automata, from the reference index (tries) or a built
  and decoded `.clxi` artefact (minimal automata); `gaddag: false` selects the DAWG path.
- fast-check runs with a fixed global seed (`test/setup.ts`).

## Invariants

1. **Purity (BOT-2).** `src/` never imports `MatchState`, `apply`, `createMatch`, `replay`, `parseState`,
   `serializeState`, `stateHash`, `observe` or any seed/stream derivation or RNG constructor
   (`@typescript-eslint/no-restricted-imports` in `eslint.config.js`, plus `test/purity.test.ts`). The
   determinism preset of `@codelex/config` bans clocks, `Math.random`, floats, async and unordered comparisons.
2. **No module state.** Scratch arrays are allocated per call.
3. **Integers only** in personality data and ranking; ties broken by the canonical key.
4. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
