# @codelex/bots

Deterministic AI opponents. No LLM, no clock, no ambient randomness: same observation, lexicon, RNG stream,
personality and budget give a deep-equal decision. Contract: `docs/architecture/notes/bots-api.md` (B0, with the
§9.1 decisions).

- Owner: `ai-engineer` (behaviour and calibration with `game-designer`)
- Coverage preset: `strict`, 90 % on lines, statements, functions and branches (`@codelex/config/vitest`)
- Status: sprint B1. Personalities `random-legal` (internal floor), `beginner` (E-1.5) and `greedy` (simulator
  yardstick). GADDAG move generation only; the DAWG fallback waits for `LexiconIndex.dawg` (L5, O-1).

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
generation (node = one successful transition, separator included; stops at `maxNodes`, best-so-far) → policy
(`random-legal`: uniform pick in key order + one `evaluateMove`; `beginner`/`greedy`: vocabulary filter,
attention sample or cap, `evaluateMove`, rank by total then key, missed Full Stack, weighted top-N) → rule-correct
fallback (EXCHANGE of the rack minus blanks if the bag holds ≥ 7, else PASS; never RESIGN). Scores come only from
`evaluateMove`.

An index without a GADDAG (the reference index and the `.clxi` decoder today) yields no candidates, so the bot
always plays the fallback until L5 ships the GADDAG section (and the DAWG fallback is added).

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
- `test/support/gaddag.ts` builds a test-only GADDAG over any index's forms until L5 lands.
- fast-check runs with a fixed global seed (`test/setup.ts`).

## Invariants

1. **Purity (BOT-2).** `src/` never imports `MatchState`, `apply`, `createMatch`, `replay`, `parseState`,
   `serializeState`, `stateHash`, `observe` or any seed/stream derivation or RNG constructor
   (`@typescript-eslint/no-restricted-imports` in `eslint.config.js`, plus `test/purity.test.ts`). The
   determinism preset of `@codelex/config` bans clocks, `Math.random`, floats, async and unordered comparisons.
2. **No module state.** Scratch arrays are allocated per call.
3. **Integers only** in personality data and ranking; ties broken by the canonical key.
4. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
