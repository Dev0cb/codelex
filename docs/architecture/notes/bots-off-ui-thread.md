# Spike note — running bots off the UI thread on Hermes (sprint 3, P5)

- Status: Proposed · Date: 2026-10-05 · Owner/author: mobile-engineer (with ai-engineer for the `packages/bots` side)
- Reviewed-by: pending ai-engineer, ux-ui-designer (§4.2 input rules), solution-architect (§6 switch rule)
- Sprint: `docs/sprints/2026-10-04-phase1-playtest-gates.md`, task P5 (1-day spike, written result). Feeds S1.
- Acceptance (row P5): input stays responsive during a 2 s compute; decisions identical to Node; ADR-0015 only if
  a second runtime is chosen.
- Inputs: `docs/architecture/notes/bots-api.md` (BOT-1, BOT-2, §6, §6.1), E-1.5 spec AC-8/AC-11 and the "Bot
  thinking" state, E-1.5 design D-4/D-29, ADR-0013 (§D1, §D4), `docs/architecture/notes/mobile-app-foundation.md`.
- No device was available (H1 is blocked on hardware). Everything below is verified locally (package sources at
  our pins, Node measurements) or stated as an estimate. H1 confirms or overturns it (§7).

## 1. Result

**Recommendation: keep the bots on the JS thread for S1 (option A), behind a `BotRunner` seam whose inputs and
outputs are plain data.** Gestures, drag, zoom and the thinking indicator run as Reanimated UI-thread worklets, so
they do not wait for the bot. Do **not** adopt a second runtime now, so **no ADR-0015**.

A worklets worker runtime (option B) is technically possible at our pins without a new dependency, but only in
Worklets **Bundle Mode**, which changes the Babel and Metro setup of the whole app (§3.2). That cost is not
justified by the numbers we have: the projected device compute is ≤ 60 ms at p95 and ≤ 0.75 s at the worst case
measured (§2). Option B is the planned fallback, with an explicit switch rule fed by H1 (§6).

Why A satisfies "input stays responsive during a 2 s compute": the 2 s case is the budget-bound worst case of
bots-api §6.1, not a typical turn. During that compute, everything the player does with a finger in motion
(dragging a tile, zooming, panning, native scrolling of the move log) stays on the UI thread and keeps 60 fps.
What waits is JS work: the drop **commit** of a pending tile (the tile lands visually, the React state catches up),
taps on JS-handled buttons and chips. §4.2 lists the rules that keep this invisible in the common case, and §6
says when it stops being acceptable.

## 2. Measurements (Node 22, proxy for budget)

Harness: a scratch Vitest file over `packages/bots/test/support` (not committed): 200 on-turn positions from
Beginner mirror games (action ≥ 2, seeds `seedOf(9000 + game)`, the same generator as `test/qa2.bench.ts`), each
decided by `chooseAction` with the frozen `BOT_VERSION` 2 budgets (Beginner 70,000 / 300, Strategist 70,000 / 500),
then again with two blanks forced into the rack (worst case). Wall time from `performance.now()` around one
`chooseAction` call. Host: 4 vCPU shared sandbox, load ≈ 2, so indicative only. Device column = Node × 10, the
sprint's provisional Hermes factor (bots-api §6.1), not a measurement.

| Lexicon (automaton) | Bot, rack | Node ms p50 / p95 / max | Nodes p95 / max | Candidates p95 / max | Cap bound | Device est. p95 / max |
|---|---|---|---|---|---|---|
| real, 2,154 forms (f1 GADDAG) | Beginner | 0.63 / 1.39 / 7.8 | 2,870 / 14,924 | 38 / 223 | 0 / 200 | 14 / 78 ms |
| real (f1) | Strategist | 0.76 / 1.93 / 12.6 | 2,870 / 14,924 | 62 / 323 | 0 / 200 | 19 / 126 ms |
| real (f1) | Strategist, 2 blanks | 13.1 / 27.3 / 35.8 | 47,576 / 63,139 | 500 / 500 | 36 / 200 | 273 / 358 ms |
| real (f0 DAWG only) | Strategist | 0.90 / 4.23 / 12.0 | 2,442 / 11,446 | 62 / 323 | 0 / 200 | 42 / 120 ms |
| real (f0) | Strategist, 2 blanks | 15.9 / 34.8 / 43.6 | 36,295 / 56,952 | 500 / 500 | 36 / 200 | 348 / 436 ms |
| synthetic 2,000 (f0) | Beginner, 2 blanks | 33.1 / 47.6 / 70.8 | 70,000 / 70,000 | 300 / 300 | 63 / 200 | 476 / 708 ms |
| synthetic 2,000 (f0) | Strategist | 1.75 / 6.09 / 18.8 | 6,173 / 25,598 | 77 / 219 | 0 / 200 | 61 / 188 ms |
| synthetic 2,000 (f0) | Strategist, 2 blanks | 39.4 / 54.6 / 75.0 | 70,000 / 70,000 | 500 / 500 | 105 / 200 | 546 / 750 ms |

Reading:

- Ordinary turns (no forced blanks) cost ≤ 6 ms at p95 on Node, so ≈ 60 ms on device at the ×10 factor, well
  under the 1.2 s minimum think delay (D-29: the move is revealed at `max(compute, delay)`).
- The tail is blank-heavy racks, where the caps bind. Even there the measured Node max is 75 ms (≈ 0.75 s
  projected). The §6.1 formula's 1.96 s is an upper bound by construction (every cap reached at the pessimistic
  constants), which is what "a 2 s compute" in the acceptance criterion refers to.
- **Decisions are identical across a serialization boundary:** for each of the 3,200 decisions above (4 lexicons ×
  2 bots × 2 rack variants × 200), the observation was round-tripped through `JSON.parse(JSON.stringify(obs))` and
  decided again with a freshly derived stream: 0 mismatches of the canonical action key. A runtime hop copies the
  same plain data, so it cannot change the decision.
- The Hermes factor is the largest unknown. Hermes has no JIT and tight integer loops are where V8 gains most, so
  a factor of 20–30 on a low-end Android is plausible (estimate). At ×30, the worst case measured becomes ≈ 2.2 s,
  which is why H1 decides (§6, §7).

## 3. Options

### 3.1 Option A: JS thread + UI-thread worklets (recommended for S1)

`chooseAction` runs synchronously on the React Native JS runtime; the board's gestures and animations are
worklets on the UI runtime (design-system v1: "0 JS-thread work per pointer-move frame").

- Cost: none. No dependency, no Babel/Metro change, Jest covers it like any other hook.
- Determinism: same Hermes bytecode as every other engine call in the app; P3's Hermes golden job covers the
  engine primitives.
- Limit: the JS thread is blocked for the length of one compute. No cancellation mid-compute (BOT-1 is
  synchronous); a stale result is discarded by `actionCount` (§4.1).

### 3.2 Option B: a Worklets worker runtime (fallback, needs Bundle Mode)

Verified in the installed sources of `react-native-worklets` 0.10.1 (already a direct dependency of
`apps/mobile`, MIT licence, `compatibility.json` lists RN 0.83–0.86, we are on 0.86.3; Reanimated 4.5.1 pairs with
it):

- API: `createWorkletRuntime({ name, initializer?, queue?, enableEventLoop? })` creates a separate Hermes runtime on
  its own thread; `runOnRuntimeAsync(runtime, worklet, ...args): Promise<R>` runs a worklet there and resolves on
  the JS thread; `scheduleOnRuntime` is the fire-and-forget form.
- **Blocker without Bundle Mode:** only functions carrying the `'worklet'` directive (and the worklets they
  capture) can run on another runtime. `packages/bots`, `packages/game-engine` and `@codelex/lexicon/index` are
  plain modules that call imports across files. A non-worklet function captured by a worklet is serialized as a
  handle to the RN-runtime function (`createSerializableNonWorkletFunction`), i.e. a hop back to the JS thread,
  not code that runs on the worker. Annotating three pure packages with an RN-specific directive is not an option
  (CLAUDE.md §1.2: one engine, no host-specific code in it).
- **With Bundle Mode** (`bundleMode: true` in the Worklets Babel plugin options, `getBundleModeMetroConfig()` from
  `react-native-worklets/bundleMode` for Expo, `importForwarding.moduleNames` for `@codelex/bots`,
  `@codelex/game-engine`, `@codelex/lexicon/index`), worker runtimes evaluate the app bundle, so imports work
  inside a worklet. The cost: the app needs its own `babel.config.js` (today it relies on `babel-preset-expo`
  defaults), Metro resolution is overridden (a `react-native` shim, a TurboModule registry shim), and the mode's
  maturity with Expo Router, EAS Update and Sentry symbolication at our pin is unverified offline (upstream has
  described it as experimental; to confirm before adoption).
- What crosses the boundary (all verified serializable by `createSerializable`: plain objects, arrays, strings,
  numbers, `ArrayBuffer`):
  - the `Observation`: ≈ 1.0 KB as JSON (p50 1,022, max 1,027 characters over 800 positions), plain data;
  - the RNG **state**, not the seed: the host calls `deriveStreamState` with the seed and the stream name
    `bot:<seat>:<n>` (ADR-0013 §D1) on the JS thread and sends the 4-word `RngState`; the worker calls `createRng(state)`. BOT-2 and AC-8 ("never the seed")
    hold;
  - the `BotDecision` back: plain data, a few hundred bytes;
  - the `.clxi` bytes, **once per runtime**: 138,352 B (f0) or 361,352 B (f1) for the current real lexicon,
    copied natively (`createSerializableArrayBuffer`; a Node copy takes 0.15–0.35 ms). The `LexiconIndex` object
    itself cannot cross: its methods close over the decoded arrays. The worker decodes its own copy (Node p50
    11.6 ms f0, 40 ms f1; ≈ 0.1–0.4 s on device at ×10, off the JS thread) and keeps it in a worker-only module.
- Package worklet-safety (what Bundle Mode needs from us): no module-level mutable state in the three packages
  (only frozen tables and two `ReadonlyMap` constants built at load; the bots' `Workspace` is per call); the
  shared lint presets already ban `TextEncoder`/`TextDecoder`, timers, `queueMicrotask`, `crypto`, `Date`,
  `WeakRef`, `Promise`/`async` and `BigInt` in shipped deterministic code, so nothing depends on RN polyfills that
  a bare worker runtime lacks. They are ready as is.
- Costs beyond Bundle Mode: a second Hermes heap plus a second decoded index (the JS thread keeps its own for score
  previews and placement hints), worker creation and bundle evaluation time, Jest cannot exercise the worker
  (worklets are mocked), so it is covered by Maestro/device only.

Sketch (not committed; for the fallback PR):

```ts
// apps/mobile/src/features/match/bot-runner.worker.ts — Bundle Mode only
const runtime = createWorkletRuntime({ name: 'codelex-bots' });
await runOnRuntimeAsync(runtime, (bytes: ArrayBuffer, id: LexiconIdentity) => {
  'worklet';
  loadWorkerLexicon(bytes, id); // decodeLexiconIndex into a worker-only module cache
}, clxiBytes, identity);
const decided = await runOnRuntimeAsync(runtime, (obs: Observation, state: RngState, p: BotPersonalityId) => {
  'worklet';
  return chooseAction(obs, { lexicon: workerLexicon(), rng: createRng(state), personality: p,
    budget: PERSONALITIES[p].budget });
}, observation, rngState, personality);
```

### 3.3 Options rejected

| Option | Why not |
|---|---|
| `react-native-worklets-core` or the older multithreading/threads libraries | A second worklet implementation next to Reanimated's (or unmaintained, legacy-architecture only): a new native dependency for what option B gives us. |
| Port the bots to Kotlin/Swift/C++ | Duplicates rule logic (CLAUDE.md §1.2) and loses bit-identity with the server and simulator. |
| Hidden WebView worker | Another JS engine (JSC/V8): breaks the "same Hermes as P3 goldens" assumption, heavy, adds a size cost. |
| Bot on the server | E-1.5 vs-bot play is offline-capable ("Offline: not a state, everything works"). |
| Evaluating a separately built bots bundle as a string in a worker | Ships code outside the signed bytecode bundle, relies on runtime `eval`; a security and review cost with no benefit over Bundle Mode. |

## 4. What S1 builds (option A done so that B is a drop-in)

### 4.1 The seam

```ts
export interface BotRequest {
  readonly observation: Observation;     // plain data, legal observation only
  readonly rngState: RngState;           // derived by the host from bot:<seat>:<n>; the seed never leaves the host
  readonly personality: BotPersonalityId;
}
export interface BotRunner {
  decide(request: BotRequest): Promise<Result<BotDecision, BotError>>;
}
```

- `createJsThreadBotRunner(lexicon)`: waits for the next frame (so the thinking indicator's first frame is
  committed), then calls `chooseAction` synchronously. A worker runner implements the same interface.
- The caller tags each request with `observation.actionCount` and drops a result whose tag is stale (resign,
  backgrounding, resume per AC-11 re-derives the same stream and recomputes the same move).
- Unit tests (Jest): decision equality with the bots' golden decisions through the runner; stale-result drop;
  the runner never receives the seed (type-level and a test).

### 4.2 Input rules during the bot's turn (D-4 allows input; only PLAY is blocked)

1. Tile drag, board pan/pinch and the drop animation are Gesture Handler + Reanimated worklets; the pending-tile
   position lives in shared values, and the commit to React state goes through `scheduleOnRN` and may lag.
2. The thinking indicator (D-25 pulsing dots, static under reduced motion) is a Reanimated animation, not a JS
   timer.
3. The move log is a plain native `ScrollView` (a match has at most a few dozen entries), not a virtualized list,
   so scrolling never needs JS to render rows.
4. The think delay timer starts before compute and the reveal is `max(compute, delay)` (D-29), so compute hides
   under the 1.2 s minimum in the common case.
5. `bot_decision_made` already carries compute time and budget exhaustion (AC-8); S1 adds no new event for this.

## 5. Risks

| ID | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| P5-R1 | Tail computes block JS: delayed drop commits and taps (up to ≈ 0.75 s projected, 2 s at the cap bound) | Medium / Medium | §4.2 rules; switch rule §6; cheaper key build (bots-api §5.6 step 1) shortens the tail for everyone. |
| P5-R2 | The Hermes factor is worse than ×10 on the reference device | Medium / High | H1 measures it (§7); budgets change only via `BOT_VERSION` 3 (bots-api §6.1), the runner choice via §6. |
| P5-R3 | Bundle Mode is immature at our pin (Expo Router, EAS Update, Sentry, dev tooling) | Medium / High (only if B is needed) | Prototype on a dev build first; fallback C below; ADR-0015 records it. |
| P5-R4 | Memory: second Hermes runtime + second decoded index on a 4 GB device | Low / Medium (B only) | H1 measures the RSS delta; create the worker lazily at match start, dispose on leaving the match. |
| P5-R5 | Runtimes diverge in a decision | Very low / High | Same Hermes and bytecode in both runtimes; packages use no host globals (lint); P3 Hermes goldens; device check in §7. |
| P5-R6 | Option A cannot be cancelled mid-compute | Low / Low | Stale results dropped by tag; compute is bounded by node budgets. |

**Fallback if B is needed and Bundle Mode fails (option C):** cooperative slicing on the JS thread. `packages/bots`
would expose a resumable decision (`start` / `step(maxNodes)` / `result`) that yields between slices of a fixed
node count; the host runs one slice per frame (≈ 4–8 ms). Since budgets are counts, slicing does not change the
decision (BOT-1/BOT-3), so no `BOT_VERSION` bump. It needs an ai-engineer design change (BOT-1 is synchronous
today; the lint ban on async stays, the host does the scheduling), so it is a fallback, not the first choice.

## 6. Switch rule (A → B), decided on H1 data

Move bots to a worker runtime (write ADR-0015, adopt Bundle Mode, or option C if Bundle Mode fails) if, on the
reference device with the shipped automaton, **any** of:

- Strategist JS-thread compute p95 > 100 ms on ordinary positions (no forced blanks), or max > 500 ms over the
  H1 position set including two-blank racks;
- UI-thread frame rate during a drag or zoom while the bot computes falls below the design-system floor (30 fps)
  or misses 60 fps for more than 5 % of frames;
- a tile drop commit or a JS-handled tap during compute takes more than 300 ms to show its result.

## 7. What H1 must measure on device

On the reference mid-range Android (4 GB RAM, Snapdragon 6-series class) and one recent iPhone, release build
(Hermes bytecode), shipped automaton (f0 or f1 per lexicon P7):

1. **Constants:** `c_node`, `c_cand`, `T_fixed` (bots-api §6), and the effective Hermes factor against the Node
   table of §2 on the same 200 positions plus the two-blank set (port the §2 harness to a bench).
2. **Compute distribution:** Beginner and Strategist p50/p95/max ms, nodes, candidates, cap-bound count.
3. **Responsiveness during a worst-case compute** (two-blank position, Strategist): UI fps while dragging and
   zooming, JS fps, drop-commit latency, tap-to-feedback latency for PLAY-adjacent buttons, log scroll.
4. **Decision equality:** keys on device equal the Node golden decisions for the 20 golden positions per bot.
5. **Only if B is prototyped:** worker creation and bundle evaluation time, `.clxi` transfer + worker decode time,
   per-decision round-trip overhead (expected < 5 ms for ≈ 1 KB in and out), RSS delta of the second runtime and
   index, and cold start unchanged (worker created lazily).
6. **Sustained play:** 10 consecutive matches vs Strategist, compute p95 drift (thermal throttling).

## 8. Follow-ups

- S1: implement §4 (seam, JS runner, input rules), feature-flagged with the slice (`play_vs_bot.enabled`).
- H1: §7; apply §6. If B is chosen: ADR-0015 (second runtime, Bundle Mode), with security-engineer review of the
  Metro/Babel changes and devops-sre for Sentry symbolication of the worker runtime.
- ai-engineer: the cheaper key build (bots-api §5.6 step 1) helps every option; option C only if §6 fires and
  Bundle Mode fails.
