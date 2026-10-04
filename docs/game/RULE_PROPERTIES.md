# CODELEX — Rule Properties, Golden Cases and Simulator Metrics

Owner: `game-designer` · Consumers: `game-engine-engineer` (E-1.1 tests), `ai-engineer` (E-1.3 bots),
E-1.6 simulator / `/balance-check`, `qa-engineer`.
Applies to: `docs/game/GAME_RULES.md` **v0.3** (`engineRulesVersion` 1) and `docs/game/BALANCE.md` v0.3. Status: draft,
2026-10-02 (v0.3 update: `classic-v1` layout, `letters-v1` table, golden cases recomputed and §3.1 added).

Every rule ID in GAME_RULES.md appears below with at least one testable property. Tests cite both the rule ID and
the property ID (e.g. `it('P-SCORE-001-b R-SCORE-001 premiums apply once', …)`).

- Property IDs: property (x) of rule `R-<AREA>-<NNN>` is `P-<AREA>-<NNN>-x` (e.g. P-SCORE-001-b); global
  properties are P-GLOBAL-NN.
- **PBT** = property-based test (fast-check), **GOLD** = example-based golden case with exact numbers
  (section 3), **SIM** = checked statistically by the E-1.6 simulator (section 5), **CONTRACT** = checked at the
  service/client boundary rather than in the pure engine.
- `AMBIGUOUS:` marks a rule that cannot be tested as written; the question is in section 6. Until resolved, the
  engine implements the "default reading" given in section 6 and the test is tagged `@ambiguous`.

## 1. Global properties (apply to every rule)

| ID | Property | Kind | Generators |
|---|---|---|---|
| P-GLOBAL-01 | **Purity**: `apply(s, a)` does not mutate `s`; calling it twice with equal inputs returns deep-equal outputs. | PBT | G-STATE, G-ACTION-ANY |
| P-GLOBAL-02 | **Replay determinism**: replaying `(seed, engineRulesVersion, lexiconVersion, profile, actionLog)` yields the same final state hash, on Node and on the RN Hermes runtime (CI matrix). | PBT | G-SEED, G-ACTIONLOG |
| P-GLOBAL-03 | **Illegal action leaves state unchanged**: if `apply` returns a Rejection, the state (incl. hash, RNG cursors, counters, clocks inside state) is byte-identical to the input. | PBT | G-STATE, G-ACTION-ANY |
| P-GLOBAL-04 | **Serialisation round-trip**: `deserialize(serialize(s))` deep-equals `s` and has the same hash. | PBT | G-STATE |
| P-GLOBAL-05 | **Tile conservation** (R-BAG-004) holds after every accepted action. | PBT | G-STATE, G-ACTION-ANY |
| P-GLOBAL-06 | **Integer, non-negative turn scores**: every per-turn score and every breakdown component is an integer ≥ 0; running scores are integers ≥ 0 until end-game adjustments (R-SCORE-006), after which they are integers (may be < 0). | PBT | G-STATE, G-ACTION-LEGAL |
| P-GLOBAL-07 | **Hidden information**: the observation for seat *i* contains no other seat's rack contents and no bag order; only counts. Holds for bots too (E-1.3 contract). | PBT + CONTRACT | G-STATE |
| P-GLOBAL-08 | **Terminal states are absorbing**: after the match ends, every action is rejected (`match_over`) and the state is unchanged. | PBT | G-TERMINAL |

## 2. Per-rule properties

### 2.1 Core
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-CORE-001 | (a) `createMatch` accepts 2–4 seats with valid team structure (1v1, 2v2, FFA ≤ 4) and rejects others with a typed error; (b) the state stores mode, format, `lexiconVersion`, `lexiconProfile`, seed; (c) two matches with the same config and seed have identical initial states; different seeds give different bag orders with overwhelming probability (no collision in 10⁵ seeds). | PBT | G-SEED, G-CONFIG | GC-DET-01 |
| R-CORE-002 | (a) No client-supplied field (score, validity, timer, power effect) is ever read by `apply`; the action schema has no such field (zod schema test). (b) Offline vs-bot results carry `competitive: false` and the progression/rating ingestion rejects them. | CONTRACT | — | — |
| R-CORE-003 | (a) A form is playable iff it matches `^[A-Z]{2,15}$`, is the `form` of a `playable: true` term or one of its declared inflections, and is in the profile; (a') an undeclared inflection (e.g. KUBERNETESES) is rejected even if its canonical term is playable; (b) lowercase, digits, 1-letter and 16-letter strings are never playable; (c) a term outside the match profile is rejected even if in the global lexicon. | PBT | G-LEX, G-STRING | GC-LEX-01 |
| R-CORE-004 | (a) `firstSeat` ∈ [0, nSeats) and is a pure function of seed; (b) over 10⁴ seeds, each seat starts with frequency 1/nSeats ± 2% (99% CI); (c) changing the `bag` stream (e.g. distribution change) does not change `firstSeat` for the same seed; (d) turn order is `firstSeat, firstSeat+1, …` mod nSeats, skipping eliminated FFA seats. | PBT | G-SEED | GC-DET-01 |
| R-CORE-005 | (a) = P-GLOBAL-02; (b) stream independence: drawing extra values from any `bot:<seat>:<n>` stream never changes the bag order or first seat; (c) the engine source contains no `Date.now`, `Math.random`, I/O (lint rule + grep test); (d) timed actions carry the timestamp as input; (e) the bot stream for a decision depends only on (seed, seat, n = actions logged before it), so a resumed match reproduces bot choices; bots never receive the seed. | PBT + lint | G-SEED, G-ACTIONLOG | GC-DET-01 |
| R-CORE-006 | (a) For every playable form *f* of term *t*: score, term bonus, tech-square match, Compile charge and chain behave exactly as if the canonical term *t* had been played with *f*'s letters (oracle: same move scored with the canonical term's metadata); (b) the inflection kind never changes any score component; (c) the stored previous main word is a form and resolves through the pinned index; (d) a form never resolves to two terms (index contract). | PBT + GOLD | G-LEX, G-LEX-SMALL, G-ACTION-LEGAL | GC-INF-01..03 |

### 2.2 Board
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-BOARD-001 | (a) Classic 15×15 start (7,7); Blitz 11×11 start (5,5); Arena 13×13 start (6,6) (0-indexed); (b) every coordinate outside the board is rejected (`placement`). | PBT + GOLD | G-PLACEMENT-GEOM | — |
| R-BOARD-002 | (a) Each layout is invariant under the 8 symmetries of the square (D4); (b) only DL/TL/DW/TW/none (+ tech tag) appear; (c) layout snapshot test per board; (d) `classic-v1` equals GAME_RULES §2.1 square by square, with counts TW 8, DW 13 (incl. (7,7)), TL 12, DL 28, no tech tags; (e) `classic-v1`: no two word multipliers orthogonally adjacent, ≥ 7 squares between word multipliers on any line, no premium other than the start within 4 squares of (7,7) on row/column 7. Blitz/Arena: AMBIGUOUS A-02 (not yet defined). | PBT + snapshot | G-LAYOUT | §3.1 |
| R-BOARD-003 | (a) Bonus = ⌊base × 0.5⌋ iff a newly covered tech square's category ∈ main term's categories; (b) 0 if the tech square was covered on an earlier turn; (c) never applied to cross-words; (d) at most once per turn; (e) bonus ≤ ⌊base/2⌋. AMBIGUOUS: A-02 (tech squares are not in `classic-v1`; positions and categories open). | PBT + GOLD | G-LAYOUT-TECH, G-ACTION-LEGAL | GC-SCORE-01 D, D', D'' |
| R-BOARD-004 | (a) First PlaceWord not covering the start square, or with 1 tile, is rejected (`placement`); (b) start-square premium is applied on the first move only (special case of P-SCORE-001-b). | PBT + GOLD | G-PLACEMENT-GEOM | GC-TURN-02, GC-CL-01..04, 15 |

### 2.3 Tiles and bag
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-BAG-001 | (a) Bag = 98 letters + 2 blanks = 100 (Classic); (b) every letter A–Z has ≥ 1 tile; (c) letter values ∈ [1, 10], and E, A, I, O, N, R, S, T = 1; (d) the table is a constant selected by `engineRulesVersion` only: two matches with the same `engineRulesVersion` and different `lexiconVersion`/profile have identical tables and bag multisets; (e) `engineRulesVersion` 1 table equals `letters-v1` (GAME_RULES §3.1) exactly (snapshot); (f) the engine contains no runtime derivation code path (derivation is an offline tool). | PBT + snapshot | G-LEX, G-CONFIG | GC-BAG-02 |
| R-BAG-002 | (a) Exactly 2 tiles with `blank: true` in a Classic bag; (b) blank value 0 in every scoring path. | PBT | G-SEED | GC-SCORE-01 F |
| R-BAG-003 | (a) After every accepted turn-ending action, the mover's rack size = min(7, rackBefore − placed + bag available); (b) other seats' racks unchanged; (c) observation hides other racks (P-GLOBAL-07). | PBT | G-STATE, G-ACTION-LEGAL | GC-BAG-01 |
| R-BAG-004 | (a) Multiset(board ∪ racks ∪ retired racks ∪ bag) = initial bag after any action sequence; blanks counted as blanks whatever their designation. | PBT | G-ACTIONLOG | GC-BAG-01 |
| R-BAG-005 | (a) Initial deal: seat 0 receives bag[0..6], seat 1 bag[7..13], …; (b) draws take from the head; (c) Exchange of *k* ∈ [1,7] tiles: rack keeps size, bag size unchanged, the returned tiles are never redrawn in the same exchange; (d) Exchange with k = 0, k > 7, tiles not in rack, or bag < 7 is rejected; (e) bag order after exchange depends only on (seed, action log). | PBT + GOLD | G-STATE, G-EXCHANGE | GC-BAG-01 |
| R-BAG-006 | (a) A placed blank must carry a designation A–Z, else rejected; (b) the designation is fixed in later turns (board square letter unchanged); (c) the blank scores 0 under DL/TL; (d) words through a blank are looked up with the designated letter. | PBT + GOLD | G-ACTION-LEGAL | GC-SCORE-01 F, GC-TURN-04, GC-CL-06, 11b, 13b, 15 |

### 2.4 Turn actions
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-TURN-001 | (a) Only the listed action types are accepted (schema); (b) Exchange rejected when bag < 7; (c) PlaceWord/Exchange/Pass advance the turn to the next seat; UsePower does not; (d) Resign accepted from any seat at any time; any other action out of turn → `not_your_turn`; (e) UsePower rejected when the mode disables powers (Classic vs bot, ranked Classic). | PBT | G-STATE, G-ACTION-ANY | GC-TURN-01 |
| R-TURN-002 | (a) Accepted placements are collinear and the main line has no empty square between first and last tile; (b) after the first move, ≥ 1 placed tile is orthogonally adjacent to a pre-existing tile; (c) tiles only on empty squares and drawn from the rack multiset; 1–7 tiles; (d) violating any of these → `placement`/`rack`, state unchanged. | PBT | G-PLACEMENT-GEOM | GC-TURN-02, GC-TURN-03 |
| R-TURN-003 | (a) An accepted PlaceWord has every formed word playable; (b) if any formed word is not playable, rejection lists exactly the non-playable forms; (c) state unchanged (P-GLOBAL-03). | PBT + GOLD | G-LEX-SMALL, G-ACTION-ANY | GC-SCORE-04 |
| R-TURN-004 | (a) The match ends exactly when the scoreless counter reaches 3 × nSeats (6 in 1v1); (b) any accepted PlaceWord (even 0 points) resets it; (c) rejections never change it; (d) UsePower never changes it; (e) counter shared across seats. | PBT + GOLD | G-ACTIONLOG | GC-TURN-05 |
| R-TURN-005 | (a) For any state and any sequence of *n* rejected actions followed by an accepted action *a*, the result equals `apply(s, a)` (rejections are invisible); (b) no rejection counter exists in state while `maxRejectionsPerTurn` is unlimited. | PBT | G-STATE, G-ACTION-ANY | GC-SCORE-04 |
| R-TURN-006 | (a) Formed words = maximal runs ≥ 2 containing ≥ 1 new tile, read L→R / T→B only; (b) the main word lies on the placement line; single tile → longer word, tie → horizontal; (c) a placement forming no word (1 tile, no neighbour) is rejected; (d) pre-existing words without new tiles are not scored. | PBT + GOLD | G-PLACEMENT-GEOM | GC-SCORE-02, GC-SCORE-03, GC-TURN-06, GC-CL-04, 12, 14 |

### 2.5 Scoring
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-SCORE-001 | (a) Word base equals the formula on a reference implementation (oracle test, independent code path); (b) **premiums applied once**: replaying the board with the premium square already covered yields no multiplier; (c) monotonic: replacing a plain square by a premium under a new tile never lowers the score. | PBT + GOLD | G-ACTION-LEGAL, G-LAYOUT | GC-SCORE-01 A, B, C, GC-CL-01..15 |
| R-SCORE-002 | (a) Turn score = Σ over formed words; (b) a new tile on DL/TL/DW/TW counts in both the main word and its cross-word. | PBT + GOLD | G-ACTION-LEGAL | GC-SCORE-02, GC-CL-07, GC-CL-12 |
| R-SCORE-003 | (a) Each formed word adds exactly bonus[difficulty(term)]; (b) bonus never multiplied (score with DW = 2 × base + bonus); (c) an inflected form gets exactly its canonical term's bonus, also as a hooked cross-word. | PBT + GOLD | G-LEX, G-ACTION-LEGAL | GC-SCORE-01, GC-SCORE-02, GC-CL-*, GC-INF-01, GC-INF-02 |
| R-SCORE-004 | (a) +50 iff exactly 7 tiles placed; (b) going out with < 7 tiles: no bonus. | PBT + GOLD | G-ACTION-LEGAL | GC-SCORE-01, GC-END-01, GC-CL-03, GC-CL-13a/b |
| R-SCORE-005 | (a) Bonus = 5 × k with k ∈ [0,5]; (b) k increments only if the main word is at undirected distance 1 of the same player's previous main word; (c) an unlinked accepted main word resets k; Pass/Exchange do not; (d) repeating the same term is not a link; (e) chains are per player (2v2 included); (f) terms are compared after form resolution: an inflection of the previous main term is not a link, an inflection of a related term is. | PBT + GOLD | G-LEX-GRAPH, G-ACTIONLOG | GC-SCORE-01 E, GC-SCORE-03, GC-CL-09a/b, GC-INF-03a/b |
| R-SCORE-006 | (a) On R-END-001: goer adds Σ other racks, each other seat subtracts its rack; (b) on R-TURN-004: each subtracts own rack, nobody adds; (c) on Resign/forfeit: no adjustment; (d) zero-sum on R-END-001 in 1v1 (adjustments sum to 0). | PBT + GOLD | G-TERMINAL | GC-END-01..03, GC-CL-E1..E5 |
| R-SCORE-007 | (a) All score values are `Number.isSafeInteger`; (b) every fractional step uses floor (check against a rational oracle). | PBT | G-ACTION-LEGAL | GC-SCORE-01 G, GC-ARENA-01 |
| R-SCORE-008 | (a) Breakdown components sum to the turn score; (b) order: base → tech → Compile → term → Full Stack/chain (permuting the order in the oracle changes results on generated cases, proving the order is exercised); (c) each step floored. | PBT + GOLD | G-ACTION-LEGAL | GC-SCORE-01 D, G |
| R-SCORE-009 | (a) `previewScore(placement)` never calls the lexicon (injected spy lexicon throws); (b) for any geometrically legal placement, `preview = Σ base + FullStack`; (c) for an accepted move, `committed − preview = term + tech + chain (+ Compile delta)` ≥ 0; (d) preview of a geometrically illegal placement is `null`. | PBT + GOLD | G-PLACEMENT-GEOM | GC-SCORE-05 |

### 2.6 Modes
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-MODE-CLASSIC-001 | (a) 1v1, 2v2 (alternating teams, shared score), FFA ≤ 4 configs are creatable; (b) live clock: a seat's remaining time decreases by elapsed time on its turns only; (c) correspondence: deadline 24 h per move. AMBIGUOUS: A-03 (what happens on clock expiry). | PBT | G-CONFIG, G-CLOCK | — |
| R-MODE-CLASSIC-002 | (a) Format `untimed-vs-bot` has no clock fields; (b) powers rejected; (c) `competitive: false`; (d) bot think delay does not exist in engine state (replay without delays gives same hash). | PBT + CONTRACT | G-SEED, G-ACTIONLOG | GC-DET-01 |
| R-MODE-BLITZ-001 | (a) A move submitted after the per-move deadline is rejected and the engine applies `Pass(timeout)` on the clock action; (b) 3 consecutive timeouts by the same seat → forfeit (R-END-002); (c) a rejected attempt does not reset the deadline. AMBIGUOUS: A-04 (per-move vs total clock). | PBT | G-CLOCK, G-ACTIONLOG | GC-TURN-07 |
| R-MODE-ARENA-001 | (a) damage = min(40, ⌊points × 0.6⌋) ≤ 40 for all moves (B-03 by construction); (b) HP never < 0 and never increases except by explicit effects; (c) HP 0 ends the match immediately. AMBIGUOUS: A-05 (points definition, target in FFA, HP ties). | PBT + GOLD | G-ACTION-LEGAL | GC-ARENA-01 |
| R-MODE-ARENA-002 | (a) Effects are read from config only; with an effect's kill switch off, results equal a run without the effect; (b) shields absorb damage before HP. AMBIGUOUS: A-06 (stacking, duration). | PBT | G-SEASON-CONFIG | — |
| R-MODE-DAILY-001 | (a) Daily #N challenges are a pure function of (N, lexiconVersion) — identical across 1,000 independent generations; (b) a second ranked submission for the same (player, N) is rejected server-side. AMBIGUOUS: A-07 (challenge content, hash function). | PBT + CONTRACT | G-DAILY-N | — |
| R-MODE-KNOWLEDGE-001 | AMBIGUOUS: A-08 — untestable as written (no challenge types or scoring formula). Placeholder property: ranking is lexicographic (accuracy desc, time asc). | — | — | — |

### 2.7 End of match
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-END-001 | (a) Match ends iff bag = 0 and the mover's rack = 0 after an accepted PlaceWord; (b) not when the bag is empty but the rack is not; (c) 2v2: either teammate going out ends it. | PBT + GOLD | G-ENDGAME | GC-END-01 |
| R-END-002 | (a) Resign → resigner loses regardless of score; (b) FFA: eliminated seat skipped, its tiles retired (P-GLOBAL-05 still holds), match continues while ≥ 2 seats; (c) no R-SCORE-006 adjustment. | PBT | G-STATE | GC-END-04 |
| R-END-003 | (a) Exactly one end reason is recorded; (b) result = argmax final score; equal → draw; (c) tie-break only when `requireWinner`; then best single turn, then not-first seat. | PBT + GOLD | G-TERMINAL | GC-END-05, GC-CL-E3 |

### 2.8 Tech Powers (out of Phase 1 scope; tests written with E-3.2)
| Rule | Properties | Kind | Generators | Golden |
|---|---|---|---|---|
| R-POW-COMPILE | (a) Applied once, to the next accepted main word only, at step 3 of R-SCORE-008; (b) charge consumed on use. AMBIGUOUS: A-09 (which word earns it; does it persist across a rejected attempt — default yes). | PBT + GOLD | G-POWER | GC-SCORE-01 G |
| R-POW-DEBUG | AMBIGUOUS: A-09 — as written it creates a letter and breaks R-BAG-004. Required property once resolved: tile conservation holds. | PBT | G-POWER | — |
| R-POW-CACHE | (a) The locked tile is never returned to the bag by the next Exchange. AMBIGUOUS: A-09 ("through refill" has no effect since refills never remove tiles). | PBT | G-POWER | — |
| R-POW-CONTAINER | AMBIGUOUS: A-09 — no Arena effect targets words in v0.2. | — | — | — |
| R-POW-REFACTOR | (a) Turn not consumed; (b) ≤ 2 tiles redrawn; (c) conservation holds (returned tiles go to the bag). AMBIGUOUS: A-09 (redraw before or after return). | PBT | G-POWER | — |
| R-POW-AIASSIST | (a) Revealed (category, length) corresponds to at least one legal move for the current board and rack; (b) reveals nothing about other racks or bag. AMBIGUOUS: A-09 (which word is chosen — must be deterministic, e.g. highest score then alphabetical). | PBT | G-POWER | — |
| R-POW-001 | (a) A second UsePower in the same turn is rejected; (b) charges never exceed 2; (c) no store/commerce code path grants charges (CONTRACT). AMBIGUOUS: A-10 (2 charges per power or total). | PBT + CONTRACT | G-POWER | — |
| R-POW-002 | (a) With a power's kill switch off for (mode, season), UsePower for it is rejected and its charge is never earned; (b) flag names exist in the flag registry. | PBT + CONTRACT | G-SEASON-CONFIG | — |

## 3. Golden cases (exact numbers)

Coordinates are `(row, col)`, 0-indexed, Classic 15×15, start square (7,7). Golden cases use **fixture layouts**
that declare only the premiums named in the case (all other squares plain), so they stay valid whatever the final
Classic layout is. Letter values: **`letters-v1`** (GAME_RULES §3.1, `engineRulesVersion` 1); all numbers below were
recomputed with it in v0.3 (they used the retired default table before). Lexicon facts are from the current seed data
(`packages/lexicon/data`): KUBERNETES expert, categories devops + cloud; POD advanced, `part_of` KUBERNETES;
CDN advanced; DNS, TCP, CD intermediate; IP, AI novice; TCP `uses` IP; AIM is not a term. §3.1 adds the facts it
uses in its own stub.

**GC-SCORE-01 — KUBERNETES, 7 tiles, DW.** Row 7 holds pre-existing N(7,8) E(7,9) T(7,10) with nothing above or
below. Rack = K U B E R E S. Player places K(7,3) U(7,4) B(7,5) E(7,6) R(7,7) E(7,11) S(7,12). Main word
KUBERNETES (10 letters), no cross-words. Letter sum: K5 U2 B3 E1 R1 N1 E1 T1 E1 S1 = **17**.

| Variant | Fixture premiums (newly covered unless stated) | base | tech | Compile | term | Full Stack | chain | **Total** |
|---|---|---|---|---|---|---|---|---|
| A | DW at (7,5) under B | 17×2 = 34 | 0 | — | +16 | +50 | 0 | **100** |
| B | A + TL at (7,3) under K | (15+12)×2 = 54 | 0 | — | +16 | +50 | 0 | **120** |
| C | only DW at (7,8), already covered by N on an earlier turn | 17 | 0 | — | +16 | +50 | 0 | **83** |
| D | A + ☁ Cloud tech square at (7,4) | 34 | +17 | — | +16 | +50 | 0 | **117** |
| D' | A + 🛡 Cybersecurity tech square at (7,4) | 34 | 0 | — | +16 | +50 | 0 | **100** |
| D'' | A + two ☁ Cloud tech squares at (7,4) and (7,6) | 34 | +17 (once) | — | +16 | +50 | 0 | **117** |
| E | A; same player's previous main word was POD (k: 0 → 1) | 34 | 0 | — | +16 | +50 | +5 | **105** |
| E' | A; previous main word linked and k was already 5 | 34 | 0 | — | +16 | +50 | +25 | **125** |
| F | A, but the K is a blank designated K (blank on TL or plain: same) | 12×2 = 24 | 0 | — | +16 | +50 | 0 | **90** |
| G | D + Compile active (powers mode only) | 34 | +17 → 51 | ⌊51×1.5⌋ = ⌊76.5⌋ = 76 | +16 | +50 | 0 | **142** |

Cross-check (not a score): lexicon `gameValue(KUBERNETES)` = 16 + 10 + 16 = 42 with the LEXICON_SPEC §4 table as
of 2026-10-02 (43 once that table is aligned on `letters-v1`; hand-off to `lexicon-engineer`); it is not the
in-game score (see A-13). Preview for A (R-SCORE-009) = 34 + 50 = **84**; committed = 100. Variant G exercises the
floor of step 3 (76.5 → 76).

**GC-SCORE-02 — cross-word with a shared DL (DNS / CDN).** Pre-existing CD at C(7,6) D(7,7). Fixture DL at (7,8).
Player places D(6,8) N(7,8) S(8,8). Main word (column 8) DNS; cross-word (row 7) CDN. (6,8) and (8,8) have no
horizontal neighbours.
- DNS: D3 + N1×2 + S1 = 6; + intermediate 4 = **10**.
- CDN: C2 + D3 + N1×2 = 7; + advanced 8 = **15**.
- Turn total **25** (3 tiles, no Full Stack; chain: if previous main word was TCP, distance DNS–TCP is 2 via UDP → no link).

**GC-SCORE-03 — single tile, main-word choice and chain.** Pre-existing TCP at (7,6)(7,7)(7,8), played by this
player last turn (k = 0). Fixture DL at (6,8). Player places I(6,8). Formed: column word IP (vertical); no row word.
Main word = IP. Score: I1×2 + P2 = 4; novice +0; TCP–IP linked (undirected) → k = 1 → +5. Total **9**.

**GC-SCORE-04 — rejection is invisible.** Pre-existing AI at (7,6)(7,7). Player places M(7,8): formed row word
AIM → rejected `not_in_lexicon: [AIM]`. State hash unchanged; scoreless counter unchanged; same seat on turn.
The player then places P(8,7), forming column IP (I1 + P2 = **3**, novice +0); the resulting state is identical
to applying that move directly without the rejected attempt (P-TURN-005-a).

**GC-SCORE-05 — preview never leaks validity.** Same placement as GC-SCORE-04 (AIM) on a fixture with DW at (7,8):
preview = (A1 + I1 + M3)×2 = **10**, identical to the preview of any valid 3-letter word with the same letter values and
squares; commit is rejected.

**GC-BAG-01 — conservation counts (1v1 Classic).** Initial: bag 100. After deal: racks 7 + 7, bag 86. Seat 0 plays
4 tiles and refills: board 4, racks 14, bag 82. Seat 1 exchanges 3: board 4, racks 14, bag 82 (sum 100 each time).
With bag = 2 and a player placing 5 tiles: they draw 2, rack = 4, bag = 0.

**GC-BAG-02 — value table snapshot.** For `engineRulesVersion` 1 the (count, value) table equals `letters-v1`
exactly: values `A1 B3 C2 D3 E1 F4 G3 H3 I1 J8 K5 L2 M3 N1 O1 P2 Q8 R1 S1 T1 U2 V6 W5 X8 Y4 Z10`, blank 0; counts
`A8 B2 C5 D3 E9 F1 G3 H2 I7 J1 K1 L4 M3 N6 O7 P4 Q1 R8 S6 T8 U3 V1 W1 X1 Y2 Z1`, 2 blanks; 100 tiles; Σ lettered
values 192. Changing `lexiconVersion` or profile leaves it unchanged (P-BAG-001-d). Derivation record: BALANCE.md.

**GC-TURN-01 — out-of-turn.** Seat 1 sends Pass on seat 0's turn → `not_your_turn`; seat 1 sends Resign → accepted,
seat 0 wins.

**GC-TURN-02 — first move.** Empty board; placing 2 tiles AI at (7,7)(7,8) is accepted (covers start, 2 tiles);
AI at (3,3)(3,4) → `placement`; a single tile at (7,7) → `placement` (R-BOARD-004).

**GC-TURN-03 — gap.** Fixture board with a single T at (7,7). Placing C(7,8) P(7,9) forms TCP → accepted;
placing C(7,8) P(7,10) with (7,9) empty → `placement` (gap); placing C(8,8) P(9,9) (diagonal) → `placement`.

**GC-TURN-04 — all-blank zero-point word resets the counter.** Two blanks designated A and I play AI (novice):
score 0 + 0 = **0**, accepted; scoreless counter → 0.

**GC-TURN-05 — R-TURN-004 counting (1v1).** Sequence: P0 Pass, P1 Exchange, P0 Pass, P1 *rejected* AIM, P1 Pass,
P0 Exchange, P1 Pass → the match ends after the 6th scoreless turn (P1's final Pass); the rejected attempt is not
counted. If P0 instead plays any accepted word as the 5th turn, the counter restarts at 0.

**GC-TURN-06 — single-tile tie.** Fixture board (not necessarily reachable) with A at (7,6) and C at (6,7);
fixture lexicon G-LEX-SMALL contains AD and CD. Placing D(7,7) forms row AD and column CD, both of length 2 →
main word = **AD** (row, tie rule); CD is a cross-word. The main-word choice matters for chain and Compile.

**GC-TURN-07 — Blitz timeout.** 60 s format; seat 0's deadline t0 + 60 000 ms; PlaceWord at t0 + 60 001 → rejected
`timeout`; clock action → Pass(timeout). Third consecutive timeout of seat 0 → forfeit, seat 1 wins.

**GC-END-01 — going out (1v1).** Bag 0. P0 places its last 3 tiles (no Full Stack). P1 rack Q Z E = 8+10+1 = 19.
P0 +19, P1 −19. If P1's rack contains a blank instead of E: 18.

**GC-END-02 — scoreless end.** After GC-TURN-05: P0 rack A B = 4 → −4; P1 rack X = 8 → −8; nobody adds.

**GC-END-03 — 2v2.** Team A goes out via A2; team B racks: B1 = K (5), B2 = Q (8) → team A +13, team B −13. If A1
still holds L (2): A1 −2, A2 +(2+5+8) = +15, team A net +13 unchanged (R-SCORE-006 v0.3 clarification).

**GC-END-04 — resign.** P0 leads 120–80 and resigns → P1 wins; scores stay 120–80, no rack adjustment.

**GC-END-05 — draw and tie-break.** Final 250–250 → draw. With `requireWinner`: best single turns 98 vs 74 → seat
with 98 wins; if equal, the seat that did not move first wins.

**GC-ARENA-01 — damage.** points 50 → ⌊30.0⌋ = 30; 66 → ⌊39.6⌋ = 39; 70 → ⌊42⌋ → capped **40**; 100 (GC-SCORE-01 A)
→ 40.

**GC-DET-01 — replay.** Fixed seed `0x00C0DE1E00000001`, bundled `lexiconVersion`, scripted action log of a full
match → stored final state hash and `firstSeat` snapshot. Re-run on Node and Hermes must match.

**GC-LEX-01 — form gate.** `K8S` (digit), `ai` (lowercase), `A` (1 letter), 16 × `A` → not playable; `AI` → playable.

### 3.1 Classic `classic-v1` golden cases (machine-readable; task E3)

These cases use the **real** layout `classic-v1` (GAME_RULES §2.1) and `letters-v1` (§3.1), so they are bound to
`engineRulesVersion` 1 (a new layout or table means a new case set, never an edit). Conventions:

- `(r, c)` 0-based; `board` = tiles already on the board (their squares are *already covered*: no premium);
  `place` = the PlaceWord tiles; `"blank": true` = a blank designated `letter` (R-BAG-006). Every tile is on an
  empty square, every placement is collinear and contiguous (R-TURN-002) and every formed word is listed.
- `firstMove: true` = empty board, first PlaceWord of the match. Otherwise the `board` is a **fixture**: it may not
  be reachable from a real match (cases marked "fixture"); engine tests build the state directly. Racks are
  assumed to contain the placed tiles; the bag is non-empty (no end-of-match effect) unless stated.
- `expected.words[]`: one entry per formed word (main first), `letterSum` = Σ letter value × letter multiplier of
  newly covered squares, `wordMult` = Π word multipliers of newly covered squares, `base = letterSum × wordMult`,
  `termBonus` per R-SCORE-003. `total = Σ(base + termBonus) + fullStack + chain` (R-SCORE-008; no tech squares,
  no powers in `classic-v1`). Field names are for transcription, not the `ScoreBreakdown` API (D4 note).
- `context` (chain cases only): the mover's previous main term and chain length `k` before the move;
  `chainKAfter` = `k` after it (R-SCORE-005).
- Every form exists in the current lexicon (`packages/lexicon/data`, commit `9ab12ff`). Stub for G-LEX-SMALL —
  difficulty: AI n, API n, CI i, CLOUD n, CLOUDFLARE a, BUCKET i, CHATBOT n, CPU n, ETL a, GO i, JSON i,
  KUBERNETES e, NAT a, PYTHON i, TCP i, ZERODAY e; relations used: BUCKET `part_of` CLOUD (link, undirected), no
  relation between PYTHON and BUCKET. Fixture runs such as NET (GC-CL-13) are not re-validated (no new tile).

```json
{
  "engineRulesVersion": 1,
  "layout": "classic-v1",
  "letters": "letters-v1",
  "scoringCases": [
    {
      "id": "GC-CL-01", "title": "First move, start DW",
      "rules": ["R-BOARD-004","R-SCORE-001","R-SCORE-003"], "firstMove": true,
      "board": [],
      "place": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "expected": {
        "words": [
          {"form":"CLOUD","main":true,"letterSum":10,"wordMult":2,"base":20,"termBonus":0}
        ],
        "fullStack": 0, "chain": 0, "total": 20
      }
    },
    {
      "id": "GC-CL-02", "title": "First move reaching the row-7 DL with 6 tiles",
      "rules": ["R-BOARD-004","R-SCORE-001"], "firstMove": true,
      "board": [],
      "place": [{"r":7,"c":2,"letter":"P"},{"r":7,"c":3,"letter":"Y"},{"r":7,"c":4,"letter":"T"},{"r":7,"c":5,"letter":"H"},{"r":7,"c":6,"letter":"O"},{"r":7,"c":7,"letter":"N"}],
      "expected": {
        "words": [
          {"form":"PYTHON","main":true,"letterSum":14,"wordMult":2,"base":28,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "total": 32
      }
    },
    {
      "id": "GC-CL-03", "title": "First move Full Stack, expert term, DL + start DW",
      "rules": ["R-SCORE-004","R-SCORE-008"], "firstMove": true,
      "board": [],
      "place": [{"r":7,"c":7,"letter":"Z"},{"r":7,"c":8,"letter":"E"},{"r":7,"c":9,"letter":"R"},{"r":7,"c":10,"letter":"O"},{"r":7,"c":11,"letter":"D"},{"r":7,"c":12,"letter":"A"},{"r":7,"c":13,"letter":"Y"}],
      "expected": {
        "words": [
          {"form":"ZERODAY","main":true,"letterSum":22,"wordMult":2,"base":44,"termBonus":16}
        ],
        "fullStack": 50, "chain": 0, "total": 110
      }
    },
    {
      "id": "GC-CL-04", "title": "Minimal first move: 2 tiles, vertical",
      "rules": ["R-BOARD-004","R-TURN-006"], "firstMove": true,
      "board": [],
      "place": [{"r":7,"c":7,"letter":"G"},{"r":8,"c":7,"letter":"O"}],
      "expected": {
        "words": [
          {"form":"GO","main":true,"letterSum":4,"wordMult":2,"base":8,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "total": 12
      }
    },
    {
      "id": "GC-CL-05", "title": "Two TLs through an existing tile (no premium on the old T)",
      "rules": ["R-SCORE-001"], "firstMove": false,
      "board": [{"r":7,"c":2,"letter":"P"},{"r":7,"c":3,"letter":"Y"},{"r":7,"c":4,"letter":"T"},{"r":7,"c":5,"letter":"H"},{"r":7,"c":6,"letter":"O"},{"r":7,"c":7,"letter":"N"}],
      "place": [{"r":6,"c":4,"letter":"E"},{"r":8,"c":4,"letter":"L"}],
      "expected": {
        "words": [
          {"form":"ETL","main":true,"letterSum":10,"wordMult":1,"base":10,"termBonus":8}
        ],
        "fullStack": 0, "chain": 0, "total": 18
      }
    },
    {
      "id": "GC-CL-06", "title": "As GC-CL-05 with the L a blank on TL: blank scores 0",
      "rules": ["R-BAG-006","R-SCORE-001"], "firstMove": false,
      "board": [{"r":7,"c":2,"letter":"P"},{"r":7,"c":3,"letter":"Y"},{"r":7,"c":4,"letter":"T"},{"r":7,"c":5,"letter":"H"},{"r":7,"c":6,"letter":"O"},{"r":7,"c":7,"letter":"N"}],
      "place": [{"r":6,"c":4,"letter":"E"},{"r":8,"c":4,"letter":"L","blank":true}],
      "expected": {
        "words": [
          {"form":"ETL","main":true,"letterSum":4,"wordMult":1,"base":4,"termBonus":8}
        ],
        "fullStack": 0, "chain": 0, "total": 12
      }
    },
    {
      "id": "GC-CL-07", "title": "Main word + cross-word, TL in main word, term bonus on the cross-word",
      "rules": ["R-SCORE-002","R-SCORE-003","R-TURN-006"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":8,"c":3,"letter":"A"},{"r":8,"c":4,"letter":"P"},{"r":8,"c":5,"letter":"I"}],
      "expected": {
        "words": [
          {"form":"API","main":true,"letterSum":8,"wordMult":1,"base":8,"termBonus":0},
          {"form":"CI","main":false,"letterSum":3,"wordMult":1,"base":3,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "total": 15
      }
    },
    {
      "id": "GC-CL-08", "title": "Extension through the already-covered start DW (not re-applied), two DLs",
      "rules": ["R-SCORE-001"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":7,"c":10,"letter":"F"},{"r":7,"c":11,"letter":"L"},{"r":7,"c":12,"letter":"A"},{"r":7,"c":13,"letter":"R"},{"r":7,"c":14,"letter":"E"}],
      "expected": {
        "words": [
          {"form":"CLOUDFLARE","main":true,"letterSum":21,"wordMult":1,"base":21,"termBonus":8}
        ],
        "fullStack": 0, "chain": 0, "total": 29
      }
    },
    {
      "id": "GC-CL-09a", "title": "Chain link: same player's previous main word CLOUD (BUCKET relates to CLOUD)",
      "rules": ["R-SCORE-005"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":6,"c":8,"letter":"B"},{"r":8,"c":8,"letter":"C"},{"r":9,"c":8,"letter":"K"},{"r":10,"c":8,"letter":"E"},{"r":11,"c":8,"letter":"T"}],
      "context": {"prevMainTerm":"CLOUD","chainK":0},
      "expected": {
        "words": [
          {"form":"BUCKET","main":true,"letterSum":16,"wordMult":1,"base":16,"termBonus":4}
        ],
        "fullStack": 0, "chain": 5, "chainKAfter": 1, "total": 25
      }
    },
    {
      "id": "GC-CL-09b", "title": "Same placement, previous main word PYTHON (unlinked): chain resets",
      "rules": ["R-SCORE-005"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":6,"c":8,"letter":"B"},{"r":8,"c":8,"letter":"C"},{"r":9,"c":8,"letter":"K"},{"r":10,"c":8,"letter":"E"},{"r":11,"c":8,"letter":"T"}],
      "context": {"prevMainTerm":"PYTHON","chainK":2},
      "expected": {
        "words": [
          {"form":"BUCKET","main":true,"letterSum":16,"wordMult":1,"base":16,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "chainKAfter": 0, "total": 20
      }
    },
    {
      "id": "GC-CL-10", "title": "DW x DW = x4 on row 1 through an existing tile (fixture)",
      "rules": ["R-SCORE-001"], "firstMove": false,
      "board": [{"r":1,"c":7,"letter":"T"},{"r":2,"c":7,"letter":"C"},{"r":3,"c":7,"letter":"P"}],
      "place": [{"r":1,"c":4,"letter":"C"},{"r":1,"c":5,"letter":"H"},{"r":1,"c":6,"letter":"A"},{"r":1,"c":8,"letter":"B"},{"r":1,"c":9,"letter":"O"},{"r":1,"c":10,"letter":"T"}],
      "expected": {
        "words": [
          {"form":"CHATBOT","main":true,"letterSum":12,"wordMult":4,"base":48,"termBonus":0}
        ],
        "fullStack": 0, "chain": 0, "total": 48
      }
    },
    {
      "id": "GC-CL-11a", "title": "TW on the edge (fixture)",
      "rules": ["R-SCORE-001"], "firstMove": false,
      "board": [{"r":0,"c":6,"letter":"N"},{"r":1,"c":6,"letter":"A"},{"r":2,"c":6,"letter":"T"}],
      "place": [{"r":0,"c":3,"letter":"J"},{"r":0,"c":4,"letter":"S"},{"r":0,"c":5,"letter":"O"}],
      "expected": {
        "words": [
          {"form":"JSON","main":true,"letterSum":11,"wordMult":3,"base":33,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "total": 37
      }
    },
    {
      "id": "GC-CL-11b", "title": "As GC-CL-11a with the J a blank on TW: word multiplier still applies",
      "rules": ["R-BAG-006","R-SCORE-001"], "firstMove": false,
      "board": [{"r":0,"c":6,"letter":"N"},{"r":1,"c":6,"letter":"A"},{"r":2,"c":6,"letter":"T"}],
      "place": [{"r":0,"c":3,"letter":"J","blank":true},{"r":0,"c":4,"letter":"S"},{"r":0,"c":5,"letter":"O"}],
      "expected": {
        "words": [
          {"form":"JSON","main":true,"letterSum":3,"wordMult":3,"base":9,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "total": 13
      }
    },
    {
      "id": "GC-CL-12", "title": "Single tile on TL forming two 2-letter words: TL counts in both; tie -> row is main (fixture)",
      "rules": ["R-SCORE-002","R-TURN-006"], "firstMove": false,
      "board": [{"r":6,"c":3,"letter":"C"},{"r":7,"c":3,"letter":"P"},{"r":8,"c":3,"letter":"U"},{"r":5,"c":4,"letter":"A"},{"r":5,"c":5,"letter":"P"},{"r":5,"c":6,"letter":"I"}],
      "place": [{"r":6,"c":4,"letter":"I"}],
      "expected": {
        "words": [
          {"form":"CI","main":true,"letterSum":5,"wordMult":1,"base":5,"termBonus":4},
          {"form":"AI","main":false,"letterSum":4,"wordMult":1,"base":4,"termBonus":0}
        ],
        "fullStack": 0, "chain": 0, "total": 13
      }
    },
    {
      "id": "GC-CL-13a", "title": "Full Stack KUBERNETES through NET, DL + TL + DL, expert (fixture)",
      "rules": ["R-SCORE-004","R-SCORE-001","R-SCORE-003"], "firstMove": false,
      "board": [{"r":4,"c":7,"letter":"N"},{"r":4,"c":8,"letter":"E"},{"r":4,"c":9,"letter":"T"}],
      "place": [{"r":4,"c":2,"letter":"K"},{"r":4,"c":3,"letter":"U"},{"r":4,"c":4,"letter":"B"},{"r":4,"c":5,"letter":"E"},{"r":4,"c":6,"letter":"R"},{"r":4,"c":10,"letter":"E"},{"r":4,"c":11,"letter":"S"}],
      "expected": {
        "words": [
          {"form":"KUBERNETES","main":true,"letterSum":23,"wordMult":1,"base":23,"termBonus":16}
        ],
        "fullStack": 50, "chain": 0, "total": 89
      }
    },
    {
      "id": "GC-CL-13b", "title": "As GC-CL-13a with the K a blank (plain square)",
      "rules": ["R-BAG-006","R-SCORE-004"], "firstMove": false,
      "board": [{"r":4,"c":7,"letter":"N"},{"r":4,"c":8,"letter":"E"},{"r":4,"c":9,"letter":"T"}],
      "place": [{"r":4,"c":2,"letter":"K","blank":true},{"r":4,"c":3,"letter":"U"},{"r":4,"c":4,"letter":"B"},{"r":4,"c":5,"letter":"E"},{"r":4,"c":6,"letter":"R"},{"r":4,"c":10,"letter":"E"},{"r":4,"c":11,"letter":"S"}],
      "expected": {
        "words": [
          {"form":"KUBERNETES","main":true,"letterSum":18,"wordMult":1,"base":18,"termBonus":16}
        ],
        "fullStack": 50, "chain": 0, "total": 84
      }
    },
    {
      "id": "GC-CL-14", "title": "Single tile: only a vertical word forms; start DW already covered",
      "rules": ["R-TURN-006","R-SCORE-001"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":6,"c":7,"letter":"G"}],
      "expected": {
        "words": [
          {"form":"GO","main":true,"letterSum":4,"wordMult":1,"base":4,"termBonus":4}
        ],
        "fullStack": 0, "chain": 0, "total": 8
      }
    },
    {
      "id": "GC-CL-15", "title": "First move with a blank on the start DW",
      "rules": ["R-BAG-006","R-BOARD-004"], "firstMove": true,
      "board": [],
      "place": [{"r":7,"c":7,"letter":"A","blank":true},{"r":7,"c":8,"letter":"I"}],
      "expected": {
        "words": [
          {"form":"AI","main":true,"letterSum":1,"wordMult":2,"base":2,"termBonus":0}
        ],
        "fullStack": 0, "chain": 0, "total": 2
      }
    }
  ],
  "endCases": [
    {
      "id": "GC-CL-E1", "title": "1v1 going out: goer adds, other subtracts (R-END-001, R-SCORE-006)",
      "seats": 2, "endReason": "going_out", "wentOut": 0,
      "scoresBefore": [200, 210], "racks": [[], ["Q","Z","E"]],
      "expected": { "adjustments": [19, -19], "final": [219, 191], "result": "seat0_wins" }
    },
    {
      "id": "GC-CL-E2", "title": "1v1 going out, opponent holds a blank (counts 0) and V",
      "seats": 2, "endReason": "going_out", "wentOut": 0,
      "scoresBefore": [180, 190], "racks": [[], ["?","V"]],
      "expected": { "adjustments": [6, -6], "final": [186, 184], "result": "seat0_wins" }
    },
    {
      "id": "GC-CL-E3", "title": "Scoreless end (R-TURN-004): each subtracts own rack, nobody adds; equal scores draw",
      "seats": 2, "endReason": "scoreless_turns", "wentOut": null,
      "scoresBefore": [150, 154], "racks": [["A","B"], ["X"]],
      "expected": { "adjustments": [-4, -8], "final": [146, 146], "result": "draw" }
    },
    {
      "id": "GC-CL-E4", "title": "2v2 (seats 0=A1, 1=B1, 2=A2, 3=B2): A2 goes out, A1 still holds L",
      "seats": 4, "teams": [[0, 2], [1, 3]], "endReason": "going_out", "wentOut": 2,
      "scoresBefore": { "teamA": 300, "teamB": 290 }, "racks": [["L"], ["K"], [], ["Q"]],
      "expected": { "adjustmentsPerSeat": [-2, -5, 15, -8], "final": { "teamA": 313, "teamB": 277 }, "result": "teamA_wins" }
    },
    {
      "id": "GC-CL-E5", "title": "Resign: no rack adjustment, resigner loses despite leading (R-END-002)",
      "seats": 2, "endReason": "resign", "resigned": 0,
      "scoresBefore": [120, 80], "racks": [["Q","Z"], ["E"]],
      "expected": { "adjustments": [0, 0], "final": [120, 80], "result": "seat1_wins" }
    }
  ]
}
```

Readable summary (same numbers):

| Case | Placement | Words: letterSum × wordMult + termBonus | Full Stack | Chain | **Total** |
|---|---|---|---|---|---|
| GC-CL-01 | CLOUD (7,5)→(7,9), first move | CLOUD 10×2 + 0 | — | — | **20** |
| GC-CL-02 | PYTHON (7,2)→(7,7), P on DL | PYTHON 14×2 + 4 | — | — | **32** |
| GC-CL-03 | ZERODAY (7,7)→(7,13), A on DL (7,12) | ZERODAY 22×2 + 16 | +50 | — | **110** |
| GC-CL-04 | GO (7,7)↓(8,7) | GO 4×2 + 4 | — | — | **12** |
| GC-CL-05 | E(6,4) L(8,4) through T of PYTHON, both TL | ETL 10×1 + 8 | — | — | **18** |
| GC-CL-06 | as 05, L blank on TL | ETL 4×1 + 8 | — | — | **12** |
| GC-CL-07 | API (8,3)→(8,5) under CLOUD, P on TL | API 8 + 0; cross CI 3 + 4 | — | — | **15** |
| GC-CL-08 | CLOUD → CLOUDFLARE, start DW already covered | CLOUDFLARE 21×1 + 8 | — | — | **29** |
| GC-CL-09a | BUCKET (6,8)↓(11,8) through U, E on TL; prev CLOUD, k 0 | BUCKET 16 + 4 | — | +5 (k→1) | **25** |
| GC-CL-09b | same, prev PYTHON, k 2 | BUCKET 16 + 4 | — | 0 (k→0) | **20** |
| GC-CL-10 | CHATBOT row 1 (1,4)→(1,10) through T, DW×DW | CHATBOT 12×4 + 0 | — | — | **48** |
| GC-CL-11a | JSO + N → JSON (0,3)→(0,6), J on TW | JSON 11×3 + 4 | — | — | **37** |
| GC-CL-11b | as 11a, J blank on TW | JSON 3×3 + 4 | — | — | **13** |
| GC-CL-12 | I on TL (6,4): row CI (main, tie), column AI | CI 5 + 4; AI 4 + 0 | — | — | **13** |
| GC-CL-13a | KUBERNETES row 4 through NET, 7 tiles | KUBERNETES 23×1 + 16 | +50 | — | **89** |
| GC-CL-13b | as 13a, K blank (plain square) | KUBERNETES 18×1 + 16 | +50 | — | **84** |
| GC-CL-14 | G (6,7) above O of CLOUD | GO 4×1 + 4 | — | — | **8** |
| GC-CL-15 | blank-A (7,7) + I (7,8), first move | AI 1×2 + 0 | — | — | **2** |

### 3.2 Inflected forms (R-CORE-003, R-CORE-006; E-1.7) — hypothetical until lexicon batch 1

Same conventions and layout as §3.1 (`classic-v1`, `letters-v1`, `engineRulesVersion` 1). **PODS is hypothetical**:
no plural is in the lexicon yet. Tests use this stub until batch 1 declares it (then they switch to the real
index without changing the numbers): `POD` (advanced, `part_of` KUBERNETES) declares `inflections: [{form: "PODS",
kind: "plural"}]`; `SQL` intermediate, `CLOUD` novice, `KUBERNETES` expert (all real).

```json
{
  "engineRulesVersion": 1,
  "layout": "classic-v1",
  "letters": "letters-v1",
  "lexiconStub": [
    { "form": "POD", "difficulty": "advanced", "relations": [{ "type": "part_of", "target": "KUBERNETES" }],
      "inflections": [{ "form": "PODS", "kind": "plural", "hypothetical": true }] },
    { "form": "SQL", "difficulty": "intermediate" },
    { "form": "CLOUD", "difficulty": "novice" },
    { "form": "KUBERNETES", "difficulty": "expert" }
  ],
  "scoringCases": [
    {
      "id": "GC-INF-01", "title": "Plural as main word (first move): canonical POD bonus +8, letters as placed",
      "rules": ["R-CORE-003","R-CORE-006","R-SCORE-003"], "firstMove": true,
      "board": [],
      "place": [{"r":7,"c":7,"letter":"P"},{"r":7,"c":8,"letter":"O"},{"r":7,"c":9,"letter":"D"},{"r":7,"c":10,"letter":"S"}],
      "expected": {
        "words": [
          {"form":"PODS","main":true,"letterSum":7,"wordMult":2,"base":14,"termBonus":8}
        ],
        "fullStack": 0, "chain": 0, "total": 22
      }
    },
    {
      "id": "GC-INF-02", "title": "Hook: S added to POD re-scores PODS as a cross-word with its full bonus (C-GD-2)",
      "rules": ["R-SCORE-002","R-SCORE-003","R-CORE-006"], "firstMove": false,
      "board": [{"r":7,"c":6,"letter":"P"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"D"}],
      "place": [{"r":7,"c":9,"letter":"S"},{"r":8,"c":9,"letter":"Q"},{"r":9,"c":9,"letter":"L"}],
      "expected": {
        "words": [
          {"form":"SQL","main":true,"letterSum":11,"wordMult":1,"base":11,"termBonus":4},
          {"form":"PODS","main":false,"letterSum":7,"wordMult":1,"base":7,"termBonus":8}
        ],
        "fullStack": 0, "chain": 0, "total": 30
      }
    },
    {
      "id": "GC-INF-03a", "title": "POD then PODS: same canonical term, not a chain link; k resets",
      "rules": ["R-SCORE-005","R-CORE-006"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":6,"c":7,"letter":"P"},{"r":8,"c":7,"letter":"D"},{"r":9,"c":7,"letter":"S"}],
      "context": {"prevMainTerm":"POD","chainK":1},
      "expected": {
        "words": [
          {"form":"PODS","main":true,"letterSum":7,"wordMult":1,"base":7,"termBonus":8}
        ],
        "fullStack": 0, "chain": 0, "chainKAfter": 0, "total": 15
      }
    },
    {
      "id": "GC-INF-03b", "title": "KUBERNETES then PODS: PODS resolves to POD, part_of KUBERNETES, so it links",
      "rules": ["R-SCORE-005","R-CORE-006"], "firstMove": false,
      "board": [{"r":7,"c":5,"letter":"C"},{"r":7,"c":6,"letter":"L"},{"r":7,"c":7,"letter":"O"},{"r":7,"c":8,"letter":"U"},{"r":7,"c":9,"letter":"D"}],
      "place": [{"r":6,"c":7,"letter":"P"},{"r":8,"c":7,"letter":"D"},{"r":9,"c":7,"letter":"S"}],
      "context": {"prevMainTerm":"KUBERNETES","chainK":0},
      "expected": {
        "words": [
          {"form":"PODS","main":true,"letterSum":7,"wordMult":1,"base":7,"termBonus":8}
        ],
        "fullStack": 0, "chain": 5, "chainKAfter": 1, "total": 20
      }
    }
  ]
}
```

In GC-INF-02 the hook earns 8 of the turn's 12 term-bonus points: this is what tripwire C-09 (BALANCE.md) measures.
GC-INF-03 places P, D, S around the existing O of CLOUD (the start DW is already covered). Undeclared
inflections (e.g. KUBERNETESES, MALWARES) are rejected `not_in_lexicon` (P-CORE-003-a').

## 4. Generators (fast-check arbitraries, owned by `game-engine-engineer`)

| ID | Produces | Notes |
|---|---|---|
| G-SEED | 64-bit seeds (bigint) | include edge seeds 0, 2⁶⁴−1 |
| G-CONFIG | mode, format, team structure, nSeats 1–5 (invalid included) | |
| G-LEX | real bundled lexicon + random synthetic lexicons (forms, difficulties, categories) | synthetic for distribution tests |
| G-LEX-SMALL | tiny fixed lexicon (≈ 50 forms incl. AI, AD, CD, CDN, DNS, IP, TCP, POD, KUBERNETES) | enables brute-force legal-move enumeration without GADDAG |
| G-LEX-GRAPH | random relation graphs over G-LEX-SMALL | chain bonus |
| G-STRING | arbitrary strings | form gate |
| G-LAYOUT / G-LAYOUT-TECH | real layouts + random D4-symmetric layouts, with/without tech squares | |
| G-PLACEMENT-GEOM | 1–8 tiles at arbitrary coordinates (on/off board, occupied, gaps, diagonal) | geometry only |
| G-ACTION-LEGAL | legal moves from a reachable state (brute force on G-LEX-SMALL; GADDAG once E-1.2 lands) | |
| G-ACTION-ANY | union of legal and illegal actions, wrong seat, malformed exchange, missing blank letter | |
| G-EXCHANGE | exchange multisets incl. k = 0, k > 7, tiles not in rack | |
| G-STATE | reachable states: seed + random legal action prefix of length 0–60 | |
| G-ACTIONLOG | full action logs incl. passes, exchanges, rejections, resigns | |
| G-ENDGAME / G-TERMINAL | states with bag ≤ 7 / terminal states of every end reason | |
| G-CLOCK | monotonic timestamps with jitter around deadlines | timed formats |
| G-POWER, G-SEASON-CONFIG, G-DAILY-N | power charges/kill switches, season effect configs, Daily numbers | later epics |

## 5. Simulator metrics (E-1.6 must output, per variant, mean ± 95% CI on paired seeds)

Protocol from BALANCE.md: ≥ 10,000 games per variant, identical seed sets for baseline and variant, seats swapped
half the time (paired: each seed played twice with seats swapped).

| Invariant | Metrics to output | Test / pass rule (targets unchanged, human gate) |
|---|---|---|
| B-01 First-player win rate ≤ 52% | win/draw/loss of `firstSeat` per bot pair (equal bots: Strategist–Strategist, Grandmaster–Grandmaster); mean first-mover score lead; per-variant (start DW vs plain, R-BOARD-004) | one-sided: upper 95% CI bound of first-seat win rate (draws = ½) ≤ 52% |
| B-02 Power lift ≤ 5 pts | per power: win rate when used ≥ 1 vs paired seed with power disabled for that seat; usage rate; mean turn of use; score delta per use | paired difference upper 95% bound ≤ 5 points; report only once powers exist (E-3.2) |
| B-03 Arena single-turn damage ≤ 40% | max and p99.9 single-turn damage; share of turns hitting the cap; distribution of ⌊points×0.6⌋ before cap | max ≤ 40 (hard, also a PBT); cap-hit share reported for feel (> 10% means the cap is doing the balancing) |
| B-04 Arena median length 4–8 min | turns per match; human-paced duration = Σ modelled think time (A-14) | median within [4, 8] min |
| B-05 Blitz 60 s Speedster think ≥ 3 s | Speedster think-time distribution (p10/p50/p90), timeout rate | median ≥ 3 s; timeout rate reported |
| B-06 2v2 seat score variance | score variance per seat (4 seats) | Brown–Forsythe test p > 0.05 (proposed test, A-14) |
| B-07 Bot ladder ≥ 60% | head-to-head win rate per adjacent pair (Beginner<Strategist<Architect<Grandmaster), both seat orders | lower 95% CI bound ≥ 60% per pair |

General diagnostics (all variants, needed for R-1 and the E-1.5 playtest):
- game length (turns, tiles placed), mean and variance of final score per seat, score margin distribution;
- end-reason mix: going out (R-END-001) vs scoreless (R-TURN-004) — **flag if R-TURN-004 endings > 10%** ⚙;
- per turn: share of Pass / Exchange / PlaceWord; share of turns where the bot found **no legal PlaceWord**
  (lexicon-thinness signal) — flag if > 15% ⚙;
- distinct terms played per game, top-20 most played terms and their share (repetition signal);
- score composition: share of points from base, term bonus, Full Stack, chain, tech squares (pillar 3:
  knowledge rewarded, not required) — flag if term bonus > 35% of points ⚙;
- Full Stack rate per game; mean chain length; tiles left in bag when the game ends;
- difficulty mix of played terms (novice/intermediate/advanced/expert) per bot personality;
- engine throughput (games/s) and bot compute time p50/p95 per personality (feeds E-1.5 AC-8).

## 6. AMBIGUOUS items (questions, default reading in brackets)

- **A-01 — RESOLVED 2026-10-02 (GAME_RULES v0.3, BALANCE v0.3):** one frozen table `letters-v1` per
  `engineRulesVersion` 1, derived offline from the unweighted lexicon (largest-remainder counts, exponent 0.75,
  listed playability adjustments); the engine never derives at runtime; the old default table is retired from the
  engine. Residual hand-off: `lexicon-engineer` aligns LEXICON_SPEC §4 / `formulas.mjs` `LETTER_VALUES` on
  `letters-v1` so card `gameValue` matches in-game letter values (A-13 stays open). Original question:
  **A-01 R-BAG-001.** Derived vs default letter values: which one does the bundled `lexiconVersion` use? The
  lexicon `gameValue` uses the fixed default table (LEXICON_SPEC §4), so derived values would make in-game scores
  diverge from displayed game values. BALANCE.md step 1 weights by "term frequency class", a field the schema does
  not have; step 2 "adjusted so the bag totals 100" lacks a rounding method. [Default: use the fixed default
  values for v0.2; derived counts with largest-remainder rounding, unweighted; values frozen per version.]
  Owner: game-designer + lexicon-engineer; BALANCE.md change needs the human.
- **A-02 — PARTIALLY RESOLVED 2026-10-02 (GAME_RULES v0.3 §2.1):** Classic layout `classic-v1` defined (original
  D4 layout, TW 8 / DW 13 / TL 12 / DL 28, no tech squares). Still open: Blitz 11×11 and Arena 13×13 layouts, and
  position/categories of tech squares (future `classic-v2`, `engineRulesVersion` bump). Original question:
  **A-02 R-BOARD-002/003.** No Classic/Blitz/Arena layout exists; number, position and categories of tech squares
  are undefined. [Default: standard-like D4 layout proposed by game-designer with E-1.1; tech squares **off** for
  the E-1.5 playtest until the layout is simulated.]
- **A-03 R-MODE-CLASSIC-001.** Is the 25 min live clock per player per match? What happens at expiry
  (loss, or pass-until-end)? Correspondence 24 h: per move? [Default: per player total; expiry = forfeit.]
- **A-04 R-MODE-BLITZ-001.** Per-move vs total clock pending playtest; are the "3 consecutive timeouts" per seat?
  [Default: per move; per seat.]
- **A-05 R-MODE-ARENA-001.** Does "points" include term/Full Stack/chain bonuses? Who takes damage in FFA? On
  R-TURN-004 ending with equal HP? [Default: turn total; next seat in order; draw.]
- **A-06 R-MODE-ARENA-002.** Shield stacking, duration, interaction with the 40 HP cap.
- **A-07 R-MODE-DAILY-001.** Challenge types undefined; "hash" must be specified (e.g. SHA-256 of `daily:<N>`
  truncated to 64 bits); practice attempts after the ranked one?
- **A-08 R-MODE-KNOWLEDGE-001.** Untestable: no challenge definitions or scoring formula.
- **A-09 Tech Powers.** Debug creates a letter from nowhere (breaks R-BAG-004 — proposal: swap with a tile of the
  chosen letter from the bag, unavailable if none left); Refactor redraw order; Cache "through refill" is a no-op;
  Container has no word-targeting effects to block; AI Assist must pick its word deterministically; Compile:
  earned by main word only or any formed word? To resolve before E-3.2.
- **A-10 R-POW-001.** "Max 2 charges stored": per power or across powers? [Default: across all powers.]
- **A-11 R-CORE-001 2v2.** Can teammates see each other's rack? Can they communicate in ranked? [Default: no; racks
  hidden from teammates.]
- **A-12 R-CORE-003 / lexicon profiles.** Org-restricted profiles change the letter derivation (R-BAG-001); can a
  ranked profile differ per locale (pillar 4)? [Default: one global ranked profile.] *(2026-10-02: the letter-table
  half is decided — one table for every profile and locale in `engineRulesVersion` 1, R-BAG-001 v0.3; the
  per-locale profile question stays open.)*
- **A-13 LEXICON gameValue vs in-game score.** `gameValue` includes a length term `2 × max(0, len − 5)` that
  in-game scoring does not have. Either rename gameValue (e.g. "term value" for cards) or add a length bonus to
  scoring. [Default: no length bonus in game; gameValue is display/XP only.]
- **A-14 BALANCE B-04/B-05/B-06.** "Human-paced" requires a think-time model and human data (none before the E-1.5
  playtest); B-06 needs a named test. [Proposal: log-normal think time per personality, calibrated on playtest
  data; Brown–Forsythe.] Targets themselves unchanged (human gate).
- **A-15 R-TURN-005 ranked anti-probing.** Unlimited free rejections let a player probe the lexicon in untimed ranked
  play. Decide before E-2.4 whether `maxRejectionsPerTurn` is enabled in ranked (needs `security-engineer`).
- **A-16 R-END-003 tie-break.** Tournament tie-break order is proposed, not decided (esports policy, human).
- **A-17 Full Stack vs rack size.** If a future mode changes rack size, is Full Stack "all rack tiles" or "7"?
  [Default: exactly 7 in v0.2.]

## 7. Traceability (enforced in CI, sprint Q4)

Every rule ID defined in GAME_RULES.md (bullets `- **R-…**` and the power table rows) and every global property
P-GLOBAL-01…08 must be covered by at least one **tagged assertion**, or the rule must be listed under `outOfScope`
with a reason in `docs/game/rule-scope.json`. `node tools/traceability/check.mjs` (run by `pnpm validate`, by
`pnpm traceability:check` and by the CI workspace job) exits 1 on any of:

- a Phase-1 rule ID or P-GLOBAL-NN with no tagged assertion (a mention without an assertion is reported as such);
- a test citing a rule ID or P-GLOBAL-NN that the specs do not define (typo or stale tag);
- an invalid `rule-scope.json` (entry without a reason, unknown ID, ID both `outOfScope` and `partial`);
- this generated table being stale (`pnpm traceability:write` refreshes it; commit the result).

**How to tag.** Put the ID in the name of the `it(...)` (`it('P-GLOBAL-05 R-BAG-004: …', …)`), in the name of an
enclosing `describe`, or in a `// @covers R-SCORE-004, P-GLOBAL-05` comment directly above the test or inside its
body. A property ID `P-<AREA>-<NNN>-x` cites its rule `R-<AREA>-<NNN>`. The tagged test must contain a real assertion.

**What counts as an assertion** (checked on the TypeScript AST of every `*.test.ts` under `packages/`, `services/`,
`apps/`): a matcher call on `expect(<non-literal>)` (including `.not`, `.resolves`, `.rejects`), `assert(...)` /
`assert.*(...)`, `fc.assert(...)`, or a direct call to a helper named `expect<Upper>…` / `assert<Upper>…`.
Never counted: `.skip`, `.todo`, `.skipIf`, `.runIf` and `.fails` tests (and anything inside `describe.skip`), a bare
`expect(x)` with no matcher, `expect(<literal>).toBe(<literal>)`-style tautologies, ranges such as `P-GLOBAL-01..08`
(not expanded), plain comment mentions without `@covers`.

**Limits (what this check cannot prove).** It proves that a live test cites the ID and calls an assertion
somewhere in its body. It does not prove that the assertion is about the cited rule, that it can fail, that it runs
on the branch where the rule applies, or that a helper called `expectX` really asserts (the helper body is not
followed). A tag on a `describe` covers every test inside it that contains an assertion, so keep `describe` tags
specific. It does not measure property-level coverage: the "cited / not cited" column lists which lettered
properties (a)…(g) of a rule are named by a tagged assertion, **informational only**. A letter that is not cited
(for example R-BAG-001 (e)/(f), R-BOARD-002 (e), R-SCORE-005 (e)/(f)) means that no test names that property; it can still
be asserted untagged. Partial coverage of a rule (`partial` in `rule-scope.json`) is recorded as a note and does not
fail the gate. Reviewers remain responsible for the quality of the assertion.

<!-- traceability:begin (generated by tools/traceability/check.mjs --write; do not edit) -->
Rule IDs in GAME_RULES.md: 49; covered by a tagged assertion: 35; out of Phase-1 scope: 14; gaps: 0.

| Rule | Status | Tagged assertions in | Properties cited / not cited (informational) | Note |
|---|---|---|---|---|
| R-CORE-001 | covered | `packages/game-engine/src/match/create.test.ts` | a,c / b |  |
| R-CORE-002 | covered | `packages/game-engine/test/phase1/tagged-rules.test.ts` | a / b | Asserted: (a) no client-supplied field (score, validity, timer, power) is read by apply. Not asserted: (b) offline vs-bot results carry `competitive: false` and ingestion rejects them; that is a progression/rating contract (Phase 2), the engine state has no such flag. |
| R-CORE-003 | covered | `packages/lexicon/src/index/clxi/clxi.test.ts` | b / a,c |  |
| R-CORE-004 | covered | `packages/game-engine/src/match/create.test.ts` | a,b / c,d |  |
| R-CORE-005 | covered | `packages/game-engine/src/rng/rng.test.ts` | — / a,b,c,d,e |  |
| R-CORE-006 | covered | `packages/game-engine/src/scoring/score.test.ts`<br>`packages/lexicon/src/index/reference.test.ts` | — / a,b,c,d |  |
| R-BOARD-001 | covered | `packages/game-engine/src/rules/constants.test.ts` | a / b |  |
| R-BOARD-002 | covered | `packages/bots/test/real-lexicon-matches.test.ts`<br>`packages/game-engine/src/rules/constants.test.ts` | a,d,e / b,c |  |
| R-BOARD-003 | out-of-scope | — | — / a,b,c,d,e | Out of scope: Tech squares are not part of classic-v1 and are off for the Phase 1 playtest (GAME_RULES section 2.1); positions and categories are open (A-02). Revisit with the first layout that has tech squares. |
| R-BOARD-004 | covered | `packages/game-engine/src/match/draft-guard.test.ts`<br>`packages/game-engine/src/placement/check.test.ts`<br>`packages/game-engine/src/rules/constants.test.ts`<br>`packages/game-engine/src/rules/registry.test.ts` | — / a,b |  |
| R-BAG-001 | covered | `packages/game-engine/src/match/create.test.ts`<br>`packages/game-engine/src/rules/constants.test.ts`<br>`packages/game-engine/src/rules/registry.test.ts`<br>`packages/game-engine/src/tiles.test.ts` | a,d / b,c,e,f |  |
| R-BAG-002 | covered | `packages/game-engine/src/rules/constants.test.ts`<br>`packages/game-engine/src/tiles.test.ts` | b / a |  |
| R-BAG-003 | covered | `packages/game-engine/src/bag/bag.test.ts`<br>`packages/game-engine/src/match/apply.test.ts` | a / b,c |  |
| R-BAG-004 | covered | `packages/bots/test/real-lexicon-matches.test.ts`<br>`packages/game-engine/src/match/create.test.ts`<br>`packages/game-engine/src/state/state.test.ts`<br>`packages/game-engine/test/phase1/tagged-rules.test.ts` | a / — |  |
| R-BAG-005 | covered | `packages/game-engine/src/bag/bag.test.ts`<br>`packages/game-engine/src/match/apply.test.ts`<br>`packages/game-engine/src/match/create.test.ts`<br>`packages/game-engine/src/rng/rng.test.ts` | a,c,d / b,e |  |
| R-BAG-006 | covered | `packages/game-engine/src/placement/check.test.ts`<br>`packages/game-engine/src/scoring/end.test.ts`<br>`packages/game-engine/src/tiles.test.ts` | d / a,b,c |  |
| R-TURN-001 | covered | `packages/game-engine/src/actions/parse.test.ts` | — / a,b,c,d,e |  |
| R-TURN-002 | covered | `packages/game-engine/src/match/apply.test.ts`<br>`packages/game-engine/src/placement/check.test.ts` | — / a,b,c,d |  |
| R-TURN-003 | covered | `packages/game-engine/src/placement/check.test.ts` | b / a,c |  |
| R-TURN-004 | covered | `packages/game-engine/src/match/apply.test.ts`<br>`packages/game-engine/src/match/decisions.test.ts`<br>`packages/game-engine/src/match/rules-versions.test.ts` | — / a,b,c,d,e |  |
| R-TURN-005 | covered | `packages/game-engine/src/match/apply.test.ts` | — / a,b |  |
| R-TURN-006 | covered | `packages/bots/src/board.test.ts`<br>`packages/game-engine/src/placement/check.test.ts` | d / a,b,c |  |
| R-SCORE-001 | covered | `packages/game-engine/src/scoring/score.test.ts` | a / b,c |  |
| R-SCORE-002 | covered | `packages/game-engine/src/scoring/score.test.ts` | — / a,b |  |
| R-SCORE-003 | covered | `packages/game-engine/src/match/draft-guard.test.ts`<br>`packages/game-engine/src/rules/registry.test.ts`<br>`packages/game-engine/src/scoring/score.test.ts` | — / a,b,c |  |
| R-SCORE-004 | covered | `packages/game-engine/src/scoring/score.test.ts` | — / a,b |  |
| R-SCORE-005 | covered | `packages/game-engine/src/scoring/score.test.ts`<br>`packages/lexicon/src/index/reference.test.ts` | a,c / b,d,e,f |  |
| R-SCORE-006 | covered | `packages/game-engine/src/match/decisions.test.ts`<br>`packages/game-engine/src/scoring/end.test.ts` | a / b,c,d |  |
| R-SCORE-007 | covered | `packages/game-engine/test/phase1/tagged-rules.test.ts` | a / b |  |
| R-SCORE-008 | covered | `packages/game-engine/src/scoring/score.test.ts` | — / a,b,c |  |
| R-SCORE-009 | covered | `packages/game-engine/src/match/observe.test.ts`<br>`packages/game-engine/src/scoring/score.test.ts` | a,c / b,d |  |
| R-MODE-CLASSIC-001 | covered | `packages/bots/test/real-lexicon-matches.test.ts`<br>`packages/game-engine/src/match/create.test.ts` | a / b,c | Asserted: (a) 1v1, 2v2 and FFA 3/4 configs. Not asserted: (b) live clock and (c) 24 h correspondence deadline need clock actions (reserved, Phase 2); expiry behaviour is A-03. |
| R-MODE-CLASSIC-002 | covered | `packages/bots/test/real-lexicon-matches.test.ts`<br>`packages/game-engine/src/match/create.test.ts`<br>`packages/game-engine/test/phase1/tagged-rules.test.ts` | a,b,d / c | Asserted: (a) no clock fields, (b) powers rejected, (d) replay without delays gives the same hash. Not asserted: (c) `competitive: false` is a progression/rating ingestion contract (Phase 2); the engine state has no such flag. |
| R-MODE-BLITZ-001 | out-of-scope | — | — / a,b,c | Out of scope: Blitz is not in Phase 1 (E-1.5 is Classic vs bot); needs the clock actions TIMEOUT and `at`, reserved in engineRulesVersion 1. |
| R-MODE-ARENA-001 | out-of-scope | — | — / a,b,c | Out of scope: Arena mode is a later epic (Phase 2+); the engine has no HP model in engineRulesVersion 1. |
| R-MODE-ARENA-002 | out-of-scope | — | — / a,b | Out of scope: Arena effects are a later epic (Phase 2+); depends on A-06 and on season config. |
| R-MODE-DAILY-001 | out-of-scope | — | — / a,b | Out of scope: Daily challenges are a later epic (Phase 2+); the generator and the server-side one-submission rule do not exist yet. |
| R-MODE-KNOWLEDGE-001 | out-of-scope | — | — | Out of scope: Knowledge challenges are untestable as written (A-08) and a later epic. |
| R-END-001 | covered | `packages/game-engine/src/match/apply.test.ts`<br>`packages/game-engine/src/scoring/end.test.ts`<br>`packages/game-engine/src/state/state.test.ts` | b / a,c |  |
| R-END-002 | covered | `packages/game-engine/src/match/apply.test.ts`<br>`packages/game-engine/src/match/decisions.test.ts`<br>`packages/game-engine/src/scoring/end.test.ts` | b / a,c |  |
| R-END-003 | covered | `packages/game-engine/src/match/decisions.test.ts`<br>`packages/game-engine/src/match/observe.test.ts`<br>`packages/game-engine/src/scoring/end.test.ts` | — / a,b,c |  |
| R-POW-COMPILE | out-of-scope | — | — / a,b | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5). |
| R-POW-DEBUG | out-of-scope | — | — | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5); also breaks conservation as written (A-09). |
| R-POW-CACHE | out-of-scope | — | — / a | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5). |
| R-POW-CONTAINER | out-of-scope | — | — | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5); also ambiguous (A-09). |
| R-POW-REFACTOR | out-of-scope | — | — / a,b,c | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5). |
| R-POW-AIASSIST | out-of-scope | — | — / a,b | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5). |
| R-POW-001 | out-of-scope | — | — / a,b,c | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5); tests are written with E-3.2. |
| R-POW-002 | out-of-scope | — | — / a,b | Out of scope: Powers are out of scope for Phase 1 (GAME_RULES section 8, E-1.5); kill switches arrive with the powers. |

| Global property | Status | Tagged assertions in |
|---|---|---|
| P-GLOBAL-01 | covered | `packages/game-engine/src/match/apply.test.ts`<br>`packages/game-engine/src/rng/rng.test.ts` |
| P-GLOBAL-02 | covered | `packages/bots/test/real-lexicon-matches.test.ts`<br>`packages/game-engine/src/replay/draft-goldens.test.ts`<br>`packages/game-engine/src/replay/log.test.ts`<br>`packages/game-engine/src/rng/rng.test.ts` |
| P-GLOBAL-03 | covered | `packages/game-engine/src/match/api-properties.test.ts`<br>`packages/game-engine/src/match/apply.test.ts` |
| P-GLOBAL-04 | covered | `packages/game-engine/src/match/draft-guard.test.ts`<br>`packages/game-engine/src/match/rules-versions.test.ts`<br>`packages/game-engine/src/state/state.test.ts` |
| P-GLOBAL-05 | covered | `packages/bots/test/real-lexicon-matches.test.ts`<br>`packages/game-engine/test/phase1/tagged-rules.test.ts` |
| P-GLOBAL-06 | covered | `packages/game-engine/test/phase1/tagged-rules.test.ts` |
| P-GLOBAL-07 | covered | `packages/game-engine/src/match/observe.test.ts` |
| P-GLOBAL-08 | covered | `packages/game-engine/src/actions/validate.test.ts`<br>`packages/game-engine/src/match/apply.test.ts` |
<!-- traceability:end -->
