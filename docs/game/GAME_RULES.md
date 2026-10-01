# CODELEX — Game Rules

Owner: `game-designer` · Implementation: `packages/game-engine` · Every rule has a stable ID cited by tests.
Version: **0.1 (draft, pre-simulation)** — values marked ⚙ are tunable and will be calibrated by `/balance-check`.

## 1. Core concepts
- **R-CORE-001** A match has 2–4 players (1v1, 2v2 teams, free-for-all), a mode, a format, a `lexiconVersion`,
  a `lexiconProfile` (global ranked, season pack, or org-restricted) and a 64-bit seed. All randomness derives
  from the seed.
- **R-CORE-002** The server is authoritative for state, validity, scoring, timers and power effects.
- **R-CORE-003** A playable term is a lexicon entry whose `form` is uppercase A–Z, 2–15 letters, `playable: true`
  and present in the match's lexicon profile.

## 2. Board
- **R-BOARD-001** Classic board 15×15; Blitz 11×11 ⚙; Arena 13×13 ⚙. Centre square is the start square.
- **R-BOARD-002** Premium squares: DL (double letter), TL (triple letter), DW (double word), TW (triple word),
  layout symmetric (D4 symmetry), defined per board in `packages/game-engine/src/board/layouts.ts`.
- **R-BOARD-003** Tech squares ⚙: a square tagged with a category (e.g. ☁ Cloud). A main word covering it whose
  term belongs to that category gains +50% of its word score (rounded down) — applied after word multipliers.

## 3. Tiles and bag
- **R-BAG-001** Letter distribution and letter values are derived from the letter frequency of the active lexicon
  profile (formula in `docs/game/BALANCE.md`), then frozen per `lexiconVersion`. Default values: A1 B3 C3 D2 E1
  F4 G2 H4 I1 J8 K5 L1 M3 N1 O1 P3 Q10 R1 S1 T1 U1 V4 W4 X8 Y4 Z10.
- **R-BAG-002** 2 blank tiles (value 0) per bag in Classic ⚙.
- **R-BAG-003** Rack size 7. Racks are refilled at end of turn from the seeded bag. Racks are hidden information.
- **R-BAG-004** Tile conservation: tiles on board + in racks + in bag = initial bag, always.

## 4. Turn actions
- **R-TURN-001** Actions: PlaceWord, Exchange (only if bag ≥ 7), Pass, UsePower (if mode allows), Resign.
- **R-TURN-002** PlaceWord: all placed tiles on one row or column, contiguous with existing tiles (no gaps), first
  word covers the start square, at least one tile adjacent to an existing tile after the first move.
- **R-TURN-003** Every word formed (main word and each cross-word of ≥ 2 letters) must be a playable term
  (R-CORE-003). Otherwise the action is rejected and the state is unchanged (no penalty in casual; in ranked
  Blitz, a rejected attempt costs no time beyond time elapsed).
- **R-TURN-004** Six consecutive scoreless turns (passes/exchanges/rejected) across all players end the match.

## 5. Scoring
- **R-SCORE-001** Word score = Σ(letter value × letter multiplier of newly covered squares) × Π(word multipliers
  of newly covered squares). Premiums apply only on the turn they are covered.
- **R-SCORE-002** Cross-words are scored with the same rule and added.
- **R-SCORE-003** **Term bonus**: each scored word adds a difficulty bonus: novice 0, intermediate +4,
  advanced +8, expert +16 ⚙ (same constants as the lexicon game value, `LEXICON_SPEC.md` §4).
- **R-SCORE-004** **Full Stack bonus**: using all 7 rack tiles in one turn adds +50 ⚙.
- **R-SCORE-005** **Chain bonus**: if the main word is related (graph distance 1, any typed relation) to the
  previous main word played by the same player, +5 per chain link, chain capped at 5 links ⚙ (feeds the
  "Word Architect" achievement).
- **R-SCORE-006** End of match: each player subtracts the value of their remaining rack; if a player went out,
  they add the sum of all other racks.
- **R-SCORE-007** All scores are integers; rounding is always down.

## 6. Modes
- **R-MODE-CLASSIC-001** Untimed per move with a 24 h correspondence clock or 25 min live clock ⚙; 1v1, 2v2
  (teammates alternate, shared score), FFA up to 4.
- **R-MODE-BLITZ-001** Formats 30 s / 60 s / 120 s **per move** ⚙ (alternative: total match clock to be
  decided by playtest); timeout = Pass; 3 consecutive timeouts = forfeit.
- **R-MODE-ARENA-001** Each player has 100 HP. A valid word deals damage = ⌊points × 0.6⌋ ⚙ capped at 40 HP per
  turn (BALANCE invariant). HP 0 → defeat. Match also ends by R-TURN-004 → higher HP wins.
- **R-MODE-ARENA-002** Special effects are attached to categories (e.g. Cybersecurity words grant a 5 HP shield
  ⚙). Effects are data-driven from season config and have kill switches.
- **R-MODE-DAILY-001** Daily #N: 5 challenges generated from (seed = hash(N), lexiconVersion) — identical for all
  players worldwide; scored by the server; one ranked attempt per player per day.
- **R-MODE-KNOWLEDGE-001** Knowledge challenges (graph chains, category sprints, definition → term) use the
  Knowledge Graph; scoring rewards accuracy then speed.

## 7. Tech Powers (Arena, casual Classic; disabled in ranked Classic by default ⚙)
| ID | Power | Effect | Charge |
|---|---|---|---|
| R-POW-COMPILE | 🔥 Compile | Next valid word ×1.5 word score (after multipliers) | earned: play an advanced+ term |
| R-POW-DEBUG | 🐛 Debug | Replace one rack letter with a chosen letter (not blank) | earned: 3 valid words |
| R-POW-CACHE | ⚡ Cache | Keep one rack tile locked through next exchange/refill | earned: Full Stack or chain ≥ 2 |
| R-POW-CONTAINER | 🐳 Container | Shield one own word from Arena effects for 2 turns | earned: 2 Cybersecurity/DevOps words |
| R-POW-REFACTOR | 🔀 Refactor | Shuffle rack and redraw up to 2 tiles without losing the turn | earned: 4 valid words |
| R-POW-AIASSIST | 🧠 AI Assist | Reveals the category and length of one playable word from your rack | earned: once per match |

- **R-POW-001** Max 1 power per turn; max 2 charges stored; powers are never purchasable.
- **R-POW-002** Every power has a remote kill switch per mode and season.

## 8. Changelog
- 0.1 — Initial rules draft (framework bootstrap).
