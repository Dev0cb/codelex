# Classic match vs bot (offline, guest)

- Epic: E-1.5 (depends on E-1.1, E-1.2, E-1.3, E-1.4; feeds E-1.6) · Vision refs: V-01, V-02, V-03, V-07, V-13, V-15 · Status: Ready for design
- Owner: product-strategist · Last update: 2026-10-07 (sprint 4 SP2: S6 split into S6a–S6d, "Send match log" in
  S6d, H1 device-class note, AC-19 remote fetch deferred to a Stage 1 gate, no crash SDK in Phase 1; see
  "Amendment SP2"). Previous: 2026-10-04 (sprint 3 SP1: game-designer findings F-1/F-2 folded into AC-3/AC-5, every
  AC re-checked against GAME_RULES 0.3.1 and BALANCE 0.4, analytics moved into the catalogue)
- Next reviews: `game-designer` (rules, bot feel), `ux-ui-designer` (flows, FTUE, copy), then `data-analyst`,
  `privacy-compliance`, `mobile-engineer`, `solution-architect` (see end of document). SP1 re-review: `game-designer`
  (AC-3, AC-5, AC-7, AC-10 wording), `data-analyst` (catalogue entries), `privacy-compliance` (FYI, new fields).

## Problem

Phase 1 has one goal: **prove the fun** (ROADMAP Phase 1). We have a rules engine (E-1.1), a lexicon index (E-1.2),
bots (E-1.3) and a design system (E-1.4), but no player can play yet. Without a complete, polished loop of
PLAY → (score) → DISCOVER on a real phone, we cannot run the internal playtest that gates Phase 2. The exit criteria
are:

| Phase 1 exit criterion | Target | Measured by this feature? |
|---|---|---|
| Internal playtest | ≥ 30 players | Yes (distribution plan below) |
| Median session length | ≥ 8 min | Yes (client analytics) |
| "Would play again" | ≥ 70% | Yes (in-app one-tap survey + debrief) |
| First-player win rate (Classic 1v1, equal bots) | ≤ 52% in simulation | No, gated by E-1.3 simulator / E-1.6 balance; this feature only consumes the calibrated config |
| Crash-free sessions | ≥ 99.5% | Yes (local unclean-exit flag `app_opened.previous_exit_unclean`, plus Play vitals / TestFlight crash stats when available; no crash SDK in Phase 1, Q-15) |

Evidence today: none (no build exists). This spec is the vehicle that produces the first evidence.

## Target players & context

- Segment: internal playtesters standing in for **casual tech-curious players** (students, junior developers,
  tech enthusiasts) and **competitive word-game players**. ASSUMPTION: the ≥ 30 testers are adults (≥ 18), recruited
  from the team, friends-and-family and partner communities (e.g. a Dakar tech community, a French school), with at
  least one third non-engineers so we do not only test on experts.
- Device: iOS and Android phones; design target is a **mid-range/low-end Android on an intermittent or absent
  network** (CLAUDE.md principle 6). ASSUMPTION: reference low-end device = Android 10+, 2–3 GB RAM, entry-level
  SoC (Galaxy A0x class); final device chosen by `qa-engineer` + `mobile-engineer`. At least 30% of testers on
  Android devices of that class.
- Context: short sessions (commute, break) and longer couch sessions; frequent interruptions (calls,
  notifications, app switches, OS process kills).
- Locale: EN and FR at launch. Board letters are always A–Z (LEXICON_SPEC §2); UI and definitions follow the
  device locale.
- No account, no sign-in, no server for gameplay. Everything playable in airplane mode.

## User stories

1. As a first-time player, I want to tap PLAY NOW and be in a real match within a minute, without creating an
   account or reading a tutorial, so that I discover the game by playing it.
2. As a player, I want to place tiles to form technology terms on a Classic board and immediately see what they
   scored and why (multipliers, term bonus, Full Stack, chain), so that I feel smart and learn the scoring by doing.
3. As a player, I want an invalid word to be rejected clearly and without penalty, so that I can experiment
   without frustration.
4. As a player, I want a bot opponent that plays at a believable pace and in a recognisable style, so that the
   match feels like a duel, not a puzzle against a machine.
5. As a player who wants more challenge, I want to choose between Beginner Bot and Strategist, so that I can
   match the opponent to my level and mood.
6. As a player who gets interrupted, I want my match to be exactly where I left it when I come back (even after
   the phone killed the app), so that I never lose progress.
7. As a player at the end of a match, I want a clear summary (result, scores, best word, terms I played, terms new
   to me) and a one-tap Play again, so that I want to start the next match.
8. As a curious player, I want to optionally open a Knowledge Card for any term played in the match and hop to
   related terms, so that I discover what KAFKA or KUBERNETES is without leaving the game feel.
9. As a French-speaking player, I want the whole interface and the definitions in French, so that the game feels
   made for me.
10. As a player on a low-end Android phone, I want the board to stay smooth and the bot to answer quickly, so that
    the game feels premium on my device.
11. As a player who prefers not to share data, I want to be able to switch off playtest analytics, so that I stay in
    control.
12. As the product team, we want privacy-respecting, offline-buffered analytics and a one-tap "would play again"
    answer, so that we can decide whether Phase 1 exit criteria are met.

## Acceptance criteria

Reference device = the low-end Android defined above unless stated. "Engine" = `packages/game-engine` (E-1.1);
all rules are applied by the engine, never re-implemented in the app (CLAUDE.md principle 2).

- **AC-1 First match within 60 s, no gate.** Given a fresh install with no account and no network, When the player
  launches the app and taps PLAY NOW, Then a Classic 1v1 match vs Beginner Bot starts with no sign-up, consent
  wall, age gate or tutorial screen in between, the board and rack are interactive ≤ 5 s after the tap on the
  reference device, and the cold start to home screen is < 3 s (ARCHITECTURE §5). Human time-to-first-match
  (first launch → first tile placed by the player or first bot move) has p50 ≤ 60 s in the playtest.
- **AC-2 Fully offline.** Given the device is in airplane mode for the whole session, When the player completes a
  match, views the summary and opens Knowledge Cards, Then every step works with no network error, spinner or
  degraded copy, and analytics are buffered locally (AC-17).
- **AC-3 Match setup.** *(SP1: F-2 folded in, rules version pinned per ADR-0014.)* Given a new match, When it is
  created, Then:
  - the match header pins `engineRulesVersion` to the app constant **`PLAY_RULES_VERSION`** (ADR-0014 "Multiple
    rules versions in one engine build"). It defaults to **1** until the sprint-3 v1/v2 decision (task BC, due
    D0+9; b2-response §9.1 item 2), must name a frozen version (never a draft: `createMatch` refuses drafts outside
    the simulator) and changes only with a new build, never through remote config;
  - the pinned version selects every outcome constant (R-CORE-005): the Classic 15×15 board (R-BOARD-001), its
    premium layout (R-BOARD-002; version 1 = `classic-v1` with the DW start square, R-BOARD-004), and the letter
    table and bag (R-BAG-001, R-BAG-002; version 1 = `letters-v1`, 98 lettered tiles + 2 blanks = 100 tiles);
  - **tech squares are off** (R-BOARD-003 inactive). Flag `board.tech_squares.enabled` exists with default **off**.
    No layout the app can pin carries tech squares (GAME_RULES §2.1), so turning the flag on changes nothing:
    no tech-square rendering, no breakdown line, no score change. The flag can only expose tech squares that the
    pinned `engineRulesVersion` defines. It never adds them at runtime, because that would change outcomes
    without a version bump (R-CORE-005);
  - the bag is shuffled once from the `bag` stream of a 64-bit seed (R-CORE-001, R-CORE-005, R-BAG-005) and 7-tile
    hidden racks are dealt (R-BAG-003);
  - the bundled `lexiconVersion` and lexicon profile are pinned (R-CORE-001, R-CORE-003);
  - the format is `untimed-vs-bot` (R-MODE-CLASSIC-002): no clock, Tech Powers disabled, free rejections;
  - the first seat is drawn from the `first-player` stream (R-CORE-004) and announced ("You start" / "Strategist
    starts").

  Per ADR-0014 (accepted), a saved match resumes under its own header version as long as that version is frozen in
  the build's rules registry. A version missing from the registry, or still a draft, leads to the `version_mismatch`
  state (States table).
- **AC-4 Valid move and score explanation.** Given it is the player's turn, When they place tiles that satisfy
  R-TURN-002 and form only playable forms (R-TURN-003, R-CORE-003) and tap PLAY, Then:
  - the engine applies the move;
  - the score shown equals the engine score (R-SCORE-001, R-SCORE-002, R-SCORE-007);
  - the breakdown renders the engine's `ScoreBreakdown` verbatim, in R-SCORE-008 order with each step floored, and
    shows each applicable component: letter/word multipliers, term bonus R-SCORE-003 (the canonical term's, also
    for an inflection, R-CORE-006), Full Stack R-SCORE-004 (exactly 7 tiles placed), and chain R-SCORE-005 with
    the linked term. It never shows a tech-square line while tech squares are off (AC-3);
  - the rack is refilled from the bag (R-BAG-003) and tile conservation holds (R-BAG-004).
- **AC-5 Live preview (flagged).** *(SP1: F-1 folded in.)* Given `match.live_score_preview` is on, When the player
  has tentatively placed tiles, Then:
  - a projected score is displayed only if the placement passes the geometric checks of R-TURN-002, with the
    lexicon not consulted;
  - the value comes from the engine's preview function, which omits every lexicon-dependent component: term bonus,
    tech-square bonus and chain bonus (**R-SCORE-009**). It therefore shows letter/word premiums and Full Stack
    only, labelled as a base score ("Base N"), and can never reveal whether a word is valid or how difficult it is;
  - no validity indicator of any kind (colour, check mark, wording) appears before PLAY. Validity is revealed only
    when PLAY is tapped;
  - the preview is never authoritative: the committed score is the result of `apply` (AC-4) and may exceed it.

  Given the flag is off, Then no preview is rendered. (Q-5 decided; the earlier assumption is closed.)
- **AC-6 Rejection without penalty.** Given the player taps PLAY with an illegal placement or a non-playable word,
  When the engine rejects it, Then:
  - the game state is unchanged, byte for byte (R-TURN-003, R-TURN-005);
  - the tiles stay where the player put them for editing;
  - a short reason is shown, naming every offending form returned by the engine with ICU pluralisation ("Not in
    the CODELEX lexicon: KUBECTL" / "Tiles must be in one line");
  - no points or time are lost, and it is still the player's turn;
  - the rejected attempt never counts toward R-TURN-004 (R-TURN-005; Q-3 decided).
- **AC-7 Rack actions.** Given it is the player's turn, Then:
  - Shuffle reorders the rack locally and uses no turn;
  - Exchange lets the player pick 1–7 tiles (R-BAG-005), is enabled only when the bag holds ≥ 7 tiles (R-TURN-001)
    and otherwise shows why it is disabled;
  - Pass asks for one confirmation;
  - placing a blank opens an A–Z letter picker; the designation is permanent and visible to the bot, and the blank
    scores 0 (R-BAG-002, R-BAG-006);
  - the first PlaceWord must cover the start square with ≥ 2 tiles (R-TURN-002, R-BOARD-004);
  - after **3 × nSeats = 6** consecutive scoreless turns across both players, the match ends (R-TURN-004). Pass
    and Exchange both count (b2-response D1-a); rejected attempts never count.
- **AC-8 Bot turn: pace and fairness.** Given it is the bot's turn, When the bot computes its move, Then:
  - a "thinking" indicator is shown;
  - the move is applied within a perceived delay of 1.2–4 s ⚙. The minimum delay keeps the bot from feeling
    instant; on the reference device the total p95 is ≤ 4 s and Strategist's compute p95 is ≤ 2 s;
  - the bot receives only its legal observation (board, own rack, unseen-tile counts; never the player's rack or
    bag order) and a fresh `bot:<seat>:<n>` stream (R-CORE-005), never the seed;
  - its search is bounded by a node-count budget, never by wall-clock time (bots-api BOT-3/BOT-4; F-7);
  - its action goes through the same engine `apply` as the player's;
  - the UI stays responsive while it thinks: the player can scroll the move log and inspect the board.

  Compute time and budget exhaustion are measured on device through `bot_decision_made` (catalogue).
- **AC-9 Bot personalities.** Given the player has completed their first match, When they open the opponent
  selector from home, Then Beginner Bot and Strategist are offered with a one-line style description and the last
  choice is remembered; Given `bots.<personality>.enabled` is off, Then that personality is hidden for new
  matches while an in-progress match against it can still be finished.
- **AC-10 End of match and summary.** Given the bag is empty and a player empties their rack (R-END-001), or
  R-TURN-004 triggers, or the player resigns (R-END-002; one confirmation; counts as a loss, R-SCORE-006 not
  applied), When the match ends, Then final scores apply R-SCORE-006 (R-END-001 and R-TURN-004 endings only) and
  R-SCORE-007, the result is Victory / Defeat / Draw (equal final scores are a draw, no tie-break in casual play,
  R-END-003), and the summary shows:
  final scores with rack adjustments, best word (highest scoring), all terms played by both sides as tappable
  chips, a "New to you" count of terms played for the first time on this device, the bot's remaining rack (final
  racks are public, R-END-003), and three actions: Play again (primary, same opponent), Change opponent, Home.
- **AC-11 Interruption and resume.** Given a match in progress, When the app is backgrounded for any duration, the
  OS kills the process, or the phone reboots, and the player returns, Then the match restores exactly (board,
  both racks, scores, bag, whose turn, move log) with zero committed moves lost; uncommitted tiles on the board
  return to the rack; if the bot was thinking, it re-derives the same `bot:<seat>:<n>` stream and, under the same
  node-count budget, plays the same deterministic move (R-CORE-005, F-7). The match state is persisted atomically
  after every applied action.
- **AC-12 One match at a time.** Given an in-progress match exists, When the home screen is shown, Then a resume
  card ("vs Strategist · Your turn · 142–128") is the primary action and PLAY NOW resumes it; starting a new match
  requires confirming that the current one will be abandoned (recorded as abandoned, not as a loss).
- **AC-13 Knowledge Card: post-play, optional, never blocking.** Given the summary is shown and
  `knowledge_card.post_match.enabled` is on, When the player taps a term chip or "Discover the terms you
  played", Then a Knowledge Card opens from local data in ≤ 300 ms showing display form, category (icon + colour),
  difficulty, definition in the app locale (≤ 160 chars, LEXICON_SPEC §2) and up to 5 related terms; tapping a
  related term opens its card and Back returns; one tap/swipe closes the card back to the summary. The card never
  opens automatically, never appears before or during the player's first match, and Play again is always one tap
  away. If the locale definition is missing, the EN definition is shown with a language tag; if the term has no
  definition at all, its chip is not tappable (no error screen).
- **AC-14 Knowledge Card kill switch.** Given `knowledge_card.post_match.enabled` is off, When a match ends, Then
  term chips are displayed but not tappable, no card entry point is shown, and the summary and Play again work
  unchanged.
- **AC-15 Localisation.** Given the device locale is FR (or EN), Then every user-facing string comes from
  `packages/i18n` catalogs (no hard-coded strings), definitions use the matching locale, numbers are
  locale-formatted, and any other locale falls back to EN. Layouts tolerate +30% text length (FR) without
  truncating actions.
- **AC-16 Accessibility and one-hand play.** Given any device, Then tiles can be placed by tap-rack-tile then
  tap-square (as well as drag), all tiles/squares/actions have screen-reader labels (e.g. "Triple word square,
  row 8 column 8, empty"), every animation has a reduced-motion alternative, category colours are always paired
  with an icon, and the summary and card remain usable at 200% system text size.
- **AC-17 Analytics: consent, local buffer, no PII.** Given analytics consent is on, When events defined in
  "Analytics & KPIs" occur, Then they are written to a persistent on-device queue (survives kill/reboot) and leave the
  device only through a user-initiated "Send playtest data" share (OS share sheet; no automatic upload, no backend,
  no third-party SDK — Q-1). The export screen summarises what the file contains; the end-of-session prompt to send
  is dismissible and shown at most once per session. Events carry an `event_id` (dedupe on import). The queue is
  kept until the tester confirms "Sent" or for 30 days, capped at 5,000 events (oldest dropped first, drop count
  reported). No event contains PII, free text or device identifiers beyond the install-scoped pseudonymous id,
  which Settings displays so a tester can request deletion of data already sent. Given consent is off, no event is
  recorded or exported and the queue is purged.
- **AC-18 "Would play again" survey (flagged).** Given `playtest.survey.enabled` is on, When the player reaches the
  summary of their 1st and 3rd completed match, Then a one-tap question "Would you play CODELEX again?"
  (Yes / Maybe / No) appears inline below the result, is dismissible, is shown at most twice per install, and
  never blocks Play again.
- **AC-19 Remote config and kill switches offline.** Given the app starts, Then flags are read from the last
  cached remote config, or from bundled defaults if none was ever fetched, and a fetch is attempted in the
  background only if a network is available (never blocking play); Given `play_vs_bot.enabled` is off, Then PLAY
  NOW shows "Matches are paused for an update — back soon" instead of starting a match, and an in-progress match
  can still be resumed and finished.

  *(SP2, 2026-10-07: the remote config fetch is **not built** in Phase 1 sprint 4. Bundled defaults are acceptable
  for the Stage 0 team dogfood; the remote fetch and a working remote kill switch are a **Stage 1 gate**. The AC
  text is unchanged: flag resolution from bundled defaults and the `play_vs_bot.enabled` off behaviour still hold
  and are still tested. See "Amendment SP2".)*
- **AC-20 Determinism and bug reports.** Given a saved match (seed, `engineRulesVersion`, `lexiconVersion`, lexicon
  profile, ordered action log; R-CORE-005), When it is replayed through the engine, Then the final state hash equals
  the stored hash; and a playtest-only "Send match log" action in Settings exports this data (no PII) for bug
  reports. *(SP2: the replay-hash part ships with S3; the "Send match log" action ships in slice S6d with the
  TM-04/05/07 confirm sheet.)*

## Non-goals

- Online play of any kind: human vs human, matchmaking, realtime, spectating (Phase 2: E-2.3, E-2.4).
- Ranked, rating, leaderboards, Daily CODELEX, tournaments (E-2.4, E-2.6, E-5.1). Local bot results are **never**
  imported into ranked, rating or competitive history later.
- Accounts, sign-in, guest → account upgrade, cloud save, cross-device sync, age gate (E-2.1).
- Tech Powers (E-3.2), Arena (E-3.1), Blitz and any per-move clock (E-2.4), 2v2 and free-for-all.
- XP, levels, technology profile, missions, achievements (E-2.5, E-3.3). The "New to you" count is local and
  informational only.
- Bots beyond Beginner and Strategist (E-3.5); hint system / AI Assist; Coach (E-4.3).
- Full knowledge graph explorer (E-3.4); Knowledge Card during the match (left behind flag, off; see Q-6).
- Store, purchases, ads, CODELEX+ or any monetisation surface (Phase 4). Nothing in this build can be bought.
- Push notifications, sharing, social, profiles.
- Tablet-optimised layouts and web. Landscape mode.

### Decisions and trade-offs (impact × confidence ÷ effort)

| Decision | Chosen | Rejected alternative | Why |
|---|---|---|---|
| Opponent at first launch | Beginner Bot, auto-selected | Opponent picker before first match | Picker costs seconds and a decision before any fun; AC-1 is the top FTUE lever |
| Clock | Untimed for the player | 25 min live clock (R-MODE-CLASSIC-001) | No opponent waiting; timer adds anxiety and complexity for low value in a playtest |
| Validity preview | Score preview on legal geometry, validity on commit | Live "valid word" indicator | Keeps vocabulary as the skill; reversible via flag |
| Persistence | Action log + periodic snapshot | Snapshot only | Enables deterministic replays, bug repro and resume; small extra cost |
| In-match Knowledge Card | Off (flag) | On | Related terms mid-match act as hints and distract; revisit with playtest data |
| Match length | Full Classic | "Quick Classic" (smaller bag) | Do not invent a mode before measuring; median match length is an explicit KPI |

## UX

Design spec to be produced by `ux-ui-designer`: `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.design.md`.

### Flow

```
First launch ─► Splash (< 3 s) ─► Home (PLAY NOW) ─► Match vs Beginner Bot ─► Summary ─┬─► Play again ─► Match
                    │                    ▲                                              ├─► Knowledge Card(s) ─► Summary
                    │                    └──────────── Home ◄──────────────────────────┤
                    └─ one-line playtest analytics notice (non-blocking, toggle in Settings)  └─► Change opponent ─► Match
Later launches ─► Home: Resume card (if match in progress) │ PLAY NOW (last opponent) │ Opponent selector
```

- Home (V-02): logo, tagline, **PLAY NOW** as the dominant action; Classic is the only active mode. ASSUMPTION:
  other modes (Battle, Blitz, Knowledge, Tournaments) are hidden in this build rather than shown as locked, to
  avoid dead ends; `ux-ui-designer` decides.
- FTUE: no tutorial wall. At most 3 contextual coach marks in the first match (place tiles; tap PLAY; your score
  breakdown), each dismissible and never shown again. Each completed step emits `onboarding_step_completed`.
- Match screen: board (Skia renderer, E-1.4), scores and bag count at top, move log, rack and actions in the thumb
  zone (PLAY, Shuffle, Exchange, Pass, menu with Resign).
- Summary: result, scores, best word, term chips, "New to you" count, Play again (primary), Change opponent, Home,
  optional survey (AC-18).
- Knowledge Card: bottom sheet over the summary; related terms as chips; back/close always visible.

### States

| State | Behaviour |
|---|---|
| Empty (first launch, no history) | Home shows PLAY NOW only; no stats or empty lists. |
| Loading (cold start, lexicon index and engine init) | Branded splash; if > 3 s, a progress indicator; never a blank screen. |
| Bot thinking | Animated indicator on the bot avatar; board remains scrollable; no input blocked except PLAY. |
| Error: lexicon index missing/corrupt | Full-screen message "We could not load the CODELEX lexicon. Restart the app; if it persists, reinstall." + crash report; no partial play. |
| Error: saved match unreadable, or created with a `lexiconVersion` not bundled or an `engineRulesVersion` missing from the build's rules registry (AC-3) | Message "This match was saved with an older version and can't be resumed." + Start new match; event `bot_match_abandoned` reason `version_mismatch` or `state_corrupt`. |
| Offline | Not a state: everything works. Remote config and analytics upload silently wait for a network. |
| Backgrounded mid-match | Persist on every action; on return restore (AC-11). No "You were away" punishment of any kind. |
| Low storage | If the state write fails, show a non-blocking warning "Low storage: your match may not be saved"; play continues. |
| Low-end Android | Reduced particle effects by default on devices under a RAM threshold ⚙; target 60 fps drag, never below 30 fps; bot compute off the UI thread. |

### Copy (EN / FR) — key strings, final copy by `ux-ui-designer`

| Key | EN | FR |
|---|---|---|
| home.play_now | PLAY NOW | JOUER |
| match.you_start | You start | Tu commences |
| match.bot_starts | {bot} starts | {bot} commence |
| match.your_turn | Your move | À toi de jouer |
| match.bot_thinking | {bot} is thinking… | {bot} réfléchit… |
| match.reject.not_in_lexicon | Not in the CODELEX lexicon: {word} | Absent du lexique CODELEX : {word} |
| match.reject.placement | Tiles must be in one line and connected | Les lettres doivent être alignées et reliées |
| summary.victory / defeat / draw | Victory / Defeat / Draw | Victoire / Défaite / Égalité |
| summary.play_again | Play again | Rejouer |
| summary.discover | Discover the terms you played | Découvre les termes joués |
| summary.new_to_you | {count} new to you | {count} nouveaux pour toi |
| home.resume | Resume vs {bot} | Reprendre contre {bot} |
| survey.play_again | Would you play CODELEX again? | Rejouerais-tu à CODELEX ? |

ASSUMPTION: FR uses informal "tu" consistent with a game tone; `ux-ui-designer` confirms.

## Rules impact

No rule is added or changed by this spec. The feature consumes Classic rules from `docs/game/GAME_RULES.md`
(0.3.1 = `engineRulesVersion` 1 at SP1) through the engine, pinned by `PLAY_RULES_VERSION` (AC-3). The original
requests to `game-designer` are all resolved:

1. Match end on going out → R-END-001 (with R-END-002 resign and R-END-003 result/draws), cited by AC-10.
2. First player → R-CORE-004 (`first-player` stream), cited by AC-3.
3. Rejected attempts vs R-TURN-004 → R-TURN-005 (rejections never count, in every mode), cited by AC-6/AC-7.
4. Vs-bot Classic format → R-MODE-CLASSIC-002 `untimed-vs-bot`, cited by AC-3.
5. Tech Powers: disabled in this format (R-MODE-CLASSIC-002). Tech squares: off (AC-3, F-2; GAME_RULES §2.1).

If the v1/v2 decision (sprint 3, BC) picks `engineRulesVersion` 2 (GAME_RULES 0.4 proposal: plain start square
`classic-v2`, lower term bonuses, `letters-v2`), only `PLAY_RULES_VERSION` changes in the app. The ACs above cite
rule IDs, not constants, so they hold for either version; AC-7's "6 scoreless turns" is unchanged in v2.

## Analytics & KPIs

### KPIs (mapped to Phase 1 exit criteria)

| KPI | Type | Target | Source |
|---|---|---|---|
| "Would play again" = Yes | **Primary** (phase exit) | ≥ 70% of testers who answered (last answer per install) | `playtest_survey_answered` + debrief interviews |
| Median session length | Exit | ≥ 8 min | `app_opened` + `app_backgrounded.foreground_ms` (session closes after 30 min in background, Q-12; length = sum of foreground intervals) |
| Active playtesters | Exit | ≥ 30 installs with ≥ 1 completed match | `bot_match_finished` |
| Crash-free sessions | Exit + guardrail | ≥ 99.5% (iOS and Android separately) | `app_opened.previous_exit_unclean` (S6a); Play vitals once the Play org account exists, TestFlight crash stats when available (no crash SDK, Q-15) |
| First-player win rate (simulation) | Exit (dependency) | ≤ 52% (B-01) | E-1.3 simulator / E-1.6 report, not this app |
| Time-to-first-match | Secondary | p50 ≤ 60 s, p90 ≤ 120 s | `onboarding_step_completed` (`first_launch` → `first_move`) |
| Match completion rate | Secondary | ≥ 65% of started matches finished (not abandoned) ⚙ | `bot_match_started` / `bot_match_finished` |
| Matches completed per tester per week | Secondary | ≥ 3 ⚙ | `bot_match_finished` |
| Play again rate (summary → new match) | Secondary | baseline | `match_summary_action` |
| Knowledge Card open rate (post-match) | Secondary | baseline; ≥ 20% of completed matches with ≥ 1 card ⚙ | `knowledge_card_opened` |
| Terms discovered per tester per week | Secondary | baseline | distinct `term_id` in `bot_word_played` (actor = player) |
| Score margin per personality (F-9) | Secondary | baseline; investigate if the median loss vs Beginner is > 100 points | `bot_match_finished.score_margin` |
| Bag count at match end (b2-response T-9; C-10 read on humans) | Secondary | baseline; share of R-TURN-004 endings with ≥ 7 tiles in the bag compared with the simulator's C-10 | `bot_match_finished.bag_count_at_end`, `end_reason` |
| Tiles on the board at match end (C-11 read on humans) | Secondary | baseline vs C-11 ≥ 90 | `bot_match_finished.tiles_on_board_at_end` |
| Forced-pass tail (P-1 input) | Secondary | baseline | `bot_match_finished.forced_pass_tail` |

### Guardrails (halt or investigate if breached)

| Guardrail | Threshold |
|---|---|
| Crash-free sessions | < 99.0% over any 24 h window → halt rollout stage |
| ANR rate (Android) | > 0.47% of sessions (Play "bad behaviour" threshold) |
| Resume failure (state lost or `state_corrupt`) | > 0.5% of resumes |
| Engine/app score mismatch | any occurrence (score shown ≠ engine score; detected by state hash in AC-20) |
| Bot response time | total p95 > 4 s, or Strategist compute p95 > 2 s, on the reference device (`bot_decision_made.compute_ms_bucket`) |
| Bot budget exhaustion | > 1 % of decisions per personality (BG-5 read on devices; `bot_decision_made.budget_exhausted`) |
| Rejected attempts per player turn | > 1.0 median (frustration / lexicon gap signal) |
| Human win rate vs Beginner Bot | < 55% (too hard) ⚙ |
| Human win rate vs Strategist | outside 20–50% ⚙ |
| Resign rate | > 15% of matches ⚙ |
| Knowledge Card dwell p50 | < 1 s (card opened by mistake) → UX review |

### Device timings (H1) — device class and method (SP2, 2026-10-07)

The reference-device thresholds above (AC-1, AC-8, AC-13 and the bot response guardrail) are read in two ways:
on device through the catalogue events (S6a onwards), and in the H1 device benchmark (raw timings, Q-14).

- **Device class label.** H1 measurements taken on the product owner's own phone are labelled **"owner device"**
  unless that phone meets the low-end reference class defined in "Target players & context" (Android 10+, 2–3 GB
  RAM, entry-level SoC). Only a reference-class measurement can pass or fail a reference-device threshold; an
  "owner device" result is evidence, not a gate. The reference-device measurement stays an **owner ask** (3–5
  low-end reference phones, playtest plan §1.1) until such a device is available. Every recorded H1 result names
  the phone model, RAM and Android version.
- **Method.** Timings come from a **preview-only Diagnostics screen** (sprint 4 task DG1) running on a **release
  Hermes build** (EAS preview profile), never on a dev client, whose development-mode checks and unminified bundle
  distort timings. The screen runs the golden runner and the device benches and shares a JSON report through the OS share
  sheet. It is removed from production builds at build time; a production bundle test proves its marker strings are
  absent.
- ASSUMPTION: the Diagnostics report carries no PII. Device model and OS version are allowed in preview builds
  only (sprint 4 task A2); the report is shared by the owner, not by playtesters.

### Events

Client-side, buffered locally (AC-17). All events carry the standard envelope from
`docs/standards/ANALYTICS_EVENTS.md` (`event_id`, `occurred_at`, `user_id`, `session_id`, `app_version`,
`platform`, `locale`, `schema_version`); here `user_id` is an **install-scoped random UUID** generated on device
(reset on reinstall). ASSUMPTION: add envelope field `uploaded_at` (set at flush) so analysts can measure buffering
delay; `occurred_at` uses the device clock and is not trusted for ordering beyond a session.

Reused from the catalogue (no change in meaning):

| Event | Use here |
|---|---|
| `app_opened` | Cold/warm start, `cold_start_ms`, `network_type` (often `none`) |
| `onboarding_step_completed` | `step` ∈ `first_launch`, `home_seen`, `play_now_tapped`, `first_move`, `coach_mark_<n>`, `first_match_completed` |
| `knowledge_card_opened` | `source` = `post_match` (or `graph` when opened from a related term) |
| `knowledge_graph_navigated` | Related-term tap inside a card |

Not reused: `match_started`, `match_finished`, `word_played`, `term_discovered` are **server** events for
competitive facts. Emitting them from an offline client would pollute server-authoritative metrics, so local
equivalents are proposed below with a distinct `bot_` prefix.

### Catalogue entries (accepted into the catalogue in sprint 3 SP1)

The `bot_*` events and the other client-local playtest events proposed here now live in
`docs/standards/ANALYTICS_EVENTS.md`, section "Client-local playtest events (E-1.5)". **The catalogue is the only
source of truth for names, types, PII class and retention; this spec no longer keeps a copy.** Changes made at
SP1:

- `bot_match_started.engine_version` is renamed `engine_rules_version` (the integer pinned by AC-3); `bot_version`
  is kept.
- `bot_match_finished` gains:
  - `bot_personality`, `bot_version` and `engine_rules_version`, so an event survives queue drops on its own;
  - `bag_count_at_end`, `tiles_on_board_at_end` and `forced_pass_tail` (b2-response T-9; C-10/C-11 read on humans);
  - `score_margin` (F-9).
- New `bot_decision_made`: one per bot decision, with compute and total latency buckets, `budget_exhausted`,
  `bot_version` and `engine_rules_version`. It covers AC-8 and the Strategist budget check on device (sprint 3 ST0
  and H1).
- New `app_backgrounded { foreground_ms }` and new property `app_opened.previous_exit_unclean` (session length and
  local crash-free; playtest plan §4.1, OQ-3).
- `bot_word_played.form_kind` from E-1.7 is added. The `tech_square` value of `bonus_flags` stays reserved: it is
  never set while tech squares are off.

Rules for these events: client-local, explicitly **non-competitive**; never consumed by rating, progression or
integrity pipelines; schema owned by `data-analyst`.

## Flags & rollout

Flags are evaluated through the OpenFeature client (ARCHITECTURE §6) with **bundled defaults** and a cached remote
config fetched opportunistically when online (AC-19). Since gameplay is offline, a remote kill switch takes effect
at the next launch with network; the hard fallback is pulling the build from the internal track.

**SP2 (2026-10-07): until the AC-19 remote fetch is built, flags resolve from bundled defaults only.** This is
accepted for Stage 0 (team dogfood, 5–10 people, daily builds possible): changing a flag means shipping a build,
and the halt action is the hard fallback (fix build, or expire the build in TestFlight/Play). A working remote kill
switch is a **Stage 1 gate** (see "Playtest distribution").

| Flag | Default (playtest build) | Purpose |
|---|---|---|
| `play_vs_bot.enabled` | on | Master switch for starting new matches (in-progress matches can finish) |
| `bots.beginner.enabled` | on | Personality availability |
| `bots.strategist.enabled` | on | Personality availability (kill if a bot bug or broken difficulty is found) |
| `bots.think_delay_ms` (config) | min 1200, max 4000 | Perceived bot pace, tunable without a build |
| `match.live_score_preview` | on | AC-5 (lexicon-free preview, R-SCORE-009) |
| `board.tech_squares.enabled` | **off** | AC-3 (F-2). No effect while the pinned layout has no tech squares; turning it on never adds tech squares at runtime |
| `knowledge_card.post_match.enabled` | on | AC-13/AC-14 kill switch |
| `knowledge_card.in_match.enabled` | off | Reserved for a later experiment (Q-6); not built in slices S1–S6d |
| `playtest.survey.enabled` | on | AC-18 (slice S6b) |
| `analytics.upload.enabled` | on | Stop uploads without a build (buffer still respects consent). SP2: dark-launch flag of slices S6a and S6c (see ASSUMPTION below) |
| `playtest.match_log.enabled` | on | SP2, ASSUMPTION: dark-launch flag of slice S6d ("Send match log" row in Settings and on the corrupt-state card) |

SP2 (2026-10-07): each S6 slice merges with its flag **off** as the bundled default on `main`; the column above is
the value in the Stage 0 / Stage 1 playtest build, flipped once the slice has passed its review. ASSUMPTION: while
`analytics.upload.enabled` is off, the consented queue records nothing, and the first-run notice, the Settings
"Playtest data" section and the export entry points are hidden; the non-analytics Settings rows (sound, vibration,
motion, handedness, versions) are not behind it. Consent (AC-17) still applies on top when the flag is on.
ASSUMPTION: `playtest.match_log.enabled` is a new flag so S6d can merge and be killed independently of the
analytics export; it changes no AC.

`PLAY_RULES_VERSION` is **not** a flag. It is a build constant (AC-3, ADR-0014): the rules version that new matches
pin cannot be changed by remote config. Switching v1 ↔ v2 means shipping a new build.

### Thin slices (each behind a flag, each measurable)

| Slice | Content | ACs | Flag | Measure |
|---|---|---|---|---|
| S1 | Home + PLAY NOW + full match vs Beginner + minimal end screen | AC-1..AC-4, AC-6, AC-7, AC-8 (Beginner), AC-10 (minimal end) | `play_vs_bot.enabled` | match completion, crash-free |
| S2 | Score breakdown + summary (best word, term chips, New to you) | AC-4 (breakdown), AC-5, AC-10 | same | play again rate |
| S3 | Persistence, resume, single in-progress match; replay hash (no export) | AC-11, AC-12, AC-20 (replay hash only) | same | resume failure rate |
| S4 | Strategist + opponent selector | AC-8 (Strategist), AC-9 | `bots.strategist.enabled` | win rate per bot |
| S5 | Post-match Knowledge Card + related terms | AC-13, AC-14 | `knowledge_card.post_match.enabled` | card open rate, dwell |
| S6a | Persistent consented event queue (survives kill/reboot, cap and drop count, 30-day expiry), consent toggle and first-run notice, Settings screen, install-scoped id shown in Settings, `app_opened.previous_exit_unclean`, `app_backgrounded.foreground_ms` | AC-17 (recording, consent, purge, install id) | `analytics.upload.enabled` | events per session recorded vs expected (queue completeness, drop count); median session length and crash-free computable from a dogfood export |
| S6b | Playtest survey ("Would you play CODELEX again?") | AC-18 | `playtest.survey.enabled` | survey answer rate (answered ÷ shown), dismiss rate |
| S6c | "Send playtest data" share: export screen, OS share sheet, envelope `exportFormat: 1`, temp-file cleanup, "Did you send the file?" confirm, end-of-session prompt | AC-17 (export, prompt, "Sent" confirmation) | `analytics.upload.enabled` | export completeness (installs with ≥ 1 export ÷ active installs; Q-1 trigger < 80 %) |
| S6d | "Send match log" in Settings and on the corrupt-state card, with the TM-04/05/07 confirm sheet | AC-20 (export part) | `playtest.match_log.enabled` | share of severity S1/S2 bug reports with a match log attached; share of logs that replay to the stored hash |

i18n (EN/FR, AC-15) and accessibility (AC-16) are part of every slice, not a final slice. AC-19 belongs to no
single slice: the bundled-defaults half ships with the flags of each slice, the remote fetch is a Stage 1 gate
(SP2). The ACs column is the SP2 mapping of the existing slices (S1–S5 unchanged in content, mapped from their
sprint records).

SP2 slicing notes (2026-10-07):

- The S6 row of SP1 ("Analytics buffer/upload, consent toggle, survey, Send match log") is replaced by S6a–S6d. Each
  is independently shippable and reviewable; dependencies: S6b and S6c need S6a; S6d needs the S6c share and
  temp-file cleanup path (TM-04).
- **"Send match log" is in S6d, not S3** (Q5 exit-check finding S4). The S3 PR (#75) shipped persistence and
  resume and added the `matchlog.*` catalogue keys, but not the export action (moved per threat-model task P9).
  ASSUMPTION (to verify in the S6d PR): until S6d ships, the corrupt-state card offers "Start a new match" only.
- S6a measure is completeness, not volume: an S6a build that drops events silently fails its slice even if the queue
  looks full.

### Playtest distribution

1. **Stage 0 — team dogfood** (5–10 people, 3–5 days): TestFlight internal testers + Google Play **internal
   testing** track. Gate to next stage: no S1/S2 bug open, crash-free ≥ 99.0%, all slices S1–S6d behind flags on.
   Flags come from bundled defaults in Stage 0 (AC-19 remote fetch not built; SP2).
2. **Stage 1 — internal playtest** (≥ 30 players, 14 days): TestFlight (internal/external group with beta review
   as needed) + Play internal/closed testing track; ≥ 30% low-end Android; mix EN/FR; two moderated debrief
   sessions (5–8 players each) plus the in-app survey. **Additional Stage 1 gate (SP2):** the AC-19 remote config
   fetch is built and a remote kill switch (`play_vs_bot.enabled` off) has been shown to reach a dogfood device.
3. **Readout**: `data-analyst` produces the Phase 1 exit readout; `product-strategist` recommends go/no-go for
   Phase 2.

**Halt criteria** (any stage): crash-free < 99.0% in 24 h; any confirmed lost committed move; any score mismatch
vs engine; Knowledge Card shows wrong-term or offensive content; bot plays an illegal move. Action: flag off the
affected surface via remote config and ship a fix build; if the flag cannot reach devices, expire the build in
TestFlight/Play and notify testers.

## Privacy, security, monetisation notes

- **Guest only, no PII.** No account, email, name, phone, contacts, location or advertising ID. The only
  identifier is an install-scoped random UUID (pseudonymous), reset on reinstall. Match data stays on device;
  only playtest analytics leave it, through a user-initiated share (AC-17). No Sentry or other crash SDK in the
  playtest build (Q-1/Q-7 decision, confirmed for all of Phase 1 by Q-15): crash-free rate comes from the local
  unclean-exit flag (`app_opened.previous_exit_unclean`, S6a) and from Play vitals / TestFlight crash statistics
  when available.
- **Consent (Q-7, decided).** Written enrollment consent first (only enrolled testers receive the build), then a
  one-time non-blocking in-app notice and a Settings toggle, default on; off = nothing recorded or exported, queue
  purged (AC-17). The consent form covers on-device storage (ePrivacy Art. 5(3)), the export, and the
  Senegal → EU transfer. Employees may decline with no consequence.
- **Playtest data handling (Q-1, decided).** Exports go to a dedicated EU-hosted mailbox alias (MFA, named access
  list of ≤ 3 analysts, no auto-forwarding). The sender's email links to the install id, so exports are personal
  data: attachments move to restricted EU storage within 7 days and the emails are deleted; raw pseudonymous files
  are deleted 6 months after the playtest ends (aggregates kept). The enrollment roster (name, email, 18+
  confirmation, country, consent) is stored separately from event data, kept until playtest end + 12 months.
  Privacy notice: controller and contact, purpose, data list, email visible to the controller, retention,
  processors, withdrawal, access/erasure via install id, EU transfer, right to complain to CNIL or Senegal's CDP.
  See `docs/compliance/DATA_MAP.md` (`LEGAL_REVIEW_REQUIRED`).
- **Minors.** Playtest cohort restricted to adults (18+, confirmed at enrollment — Q-2, decided); no age gate in
  this build. Distribution: TestFlight (external testers need Beta App Review and a privacy policy URL) and the Play
  **internal** testing track only (a closed track would trigger the Data safety form). Any public release
  requires E-2.1 age gate first.
- **Security / integrity.** Results are local and non-competitive, so client-side computation is acceptable here
  and does not contradict principle 1 (server authority applies to ranked, tournament, Arena and Daily results).
  Local results must never be importable as competitive facts. Tampering with a local install has nothing to
  gain. The "Send match log" export (slice S6d) contains no PII; its confirm sheet and share/cleanup path close
  threat-model items TM-04, TM-05 and TM-07 (`docs/security/threat-models/e-1.5-s1-persistence-match-log.md`).
- **Monetisation.** No store, prices, ads or purchasable items. No pay-to-win surface exists in this build.
- **Retention ethics.** No streaks, no notifications, no "come back" penalties, no fake urgency.

## Dependencies & risks

### Dependencies

| Dependency | Needed for | Contract expected |
|---|---|---|
| E-1.1 `packages/game-engine` | AC-3..AC-11, AC-20 | Classic rules, seeded `createMatch`, `apply(state, action)`, legal observation per seat, score breakdown, state hash, serialisable action log |
| E-1.2 `LexiconIndex` | AC-4, AC-6, AC-13 | On-device index loadable on low-end Android (ASSUMPTION: ≤ 5 MB compressed, load ≤ 500 ms), term metadata (category, difficulty, definitions EN/FR, relations) |
| E-1.3 `packages/bots` | AC-8, AC-9 | Beginner + Strategist, deterministic given seed, time-boxed compute budget, consume only the legal observation; B-07 ladder |
| E-1.4 design system + Skia board | All UI ACs | Tokens, board renderer, tile drag/tap, category icons/colours, reduced motion |
| E-1.6 balance baseline | Exit criterion B-01 | Frozen distribution/values for the bundled `lexiconVersion` |
| E-0.6 lexicon seed (≥ 300 terms) | Playability | ASSUMPTION: ≥ 300 terms is too thin for a fun 15×15 game; see R-1 |
| Playtest data export (no backend; E-2.8 is Phase 2) | AC-17 | User-initiated share of the on-device queue (Q-1) |
| `packages/i18n` | AC-15 | Catalog loading |

### Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Lexicon too small: players constantly rejected or racks unplayable (only tech terms, ~300 entries) | High | High | `lexicon-curator` grows seed for playtest (target ASSUMPTION ≥ 2,000 playable forms incl. many 2–4 letter terms); track `word_rejected`; E-1.6 simulation reports pass rate |
| R-2 | Full Classic match too long for "fun" and first impressions | Medium | High | Resume makes long matches safe; measure match length; Quick Classic as a candidate experiment, not built now |
| R-3 | Feels like homework (definitions, "lexicon" wording) | Medium | High | Cards strictly post-play and opt-in; game-feel polish on scoring; tone review by `ux-ui-designer` |
| R-4 | Bot too slow or janky on low-end Android | Medium | High | Compute off UI thread, time-boxed search, perf AC-8 on reference device in CI device farm |
| R-5 | State loss on OS kill | Medium | High | Atomic writes after every action, action-log replay, resume tests in Maestro with process kill |
| R-6 | Analytics gaps from offline buffering → unreadable exit criteria | Medium | Medium | Persistent queue, drop counters, debrief interviews as a second source for "would play again" |
| R-7 | Bot difficulty mismatch (Beginner too strong for non-engineers) | Medium | Medium | Remote-tunable bot config, guardrails on human win rates |
| R-8 | Lexicon update in a new build breaks resume of in-progress matches | Low | Low | Graceful `version_mismatch` handling (states table); acceptable in playtest |
| R-9 | Trademark/product terms displayed in cards | Low | Medium | Lexicon `owner` field already required for `product` kind; curator review |

## Decisions (formerly open questions)

Decided 2026-10-02 by the orchestrator under delegation from the product owner ("take the best decisions for
me"), reviewed by `privacy-compliance`; each is reversible. Items marked `LEGAL_REVIEW_REQUIRED` need counsel before
the playtest starts.

- **Q-1 Analytics transport.** No backend and no third-party SDK in Phase 1. Events are zod-validated into a
  transport-agnostic on-device queue and leave the device only via a user-initiated "Send playtest data" share
  (AC-17); debrief interviews are the second source. If export completeness is < 80% after week 1, propose a
  minimal first-party EU endpoint (needs `devops-sre`, `security-engineer`, threat model). No Sentry in the
  playtest build.
- **Q-2 Cohort.** Adults only (18+ confirmed at enrollment), ≥ 30 players, ≥ 1/3 non-engineers, ≥ 30% low-end
  Android, EN and FR speakers including testers in Senegal and France, written consent form.
- **Q-3** Rejected attempts do not count toward R-TURN-004 and do not end the turn (GAME_RULES v0.2).
- **Q-4** Seeded coin flip for the first player; untimed vs-bot format (GAME_RULES v0.2).
- **Q-5** Score preview on legal geometry only; validity on commit (GAME_RULES v0.2).
- **Q-6** No Knowledge Card during a match in this build (flag reserved, off).
- **Q-7 Consent.** Enrollment consent + in-app notice + Settings toggle, default on (acceptable because consent
  precedes install); details in "Privacy, security, monetisation notes".
- **Q-8** `word_rejected` excludes the attempted form. Lexicon gaps come from the debrief form and from
  bot/simulation rejection analysis; reconsider (blocklist + opt-in) only for a public build.
- **Q-9** ≥ 2,000 playable forms for the playtest (E-1.7), validated by E-1.6 simulation.
- **Q-10** No migration of local results or ratings, ever; terms-discovered migration decided in E-2.1.
- **Q-11** Hide modes that are not playable (no "Coming soon").
- **Q-12** Session = foreground time, closed after 30 min in background (as in KPIs).
- **Q-13 (SP1, 2026-10-04) Rules version is a build constant, not a flag.** `PLAY_RULES_VERSION` (default 1) pins
  new matches (AC-3). Rejected: a remote-config rules version. It would let one build produce matches under two
  rule sets without a build trail, it gains nothing because the playtest ships at most one planned rebuild
  (playtest plan §3.4), and it would weaken the "Send match log" reproduction. ICE: impact high (data integrity)
  × confidence high ÷ effort low.
- **Q-14 (SP1) Bot latency is measured per decision in buckets, not as raw milliseconds.** Buckets are enough to
  read p95 against the 2 s / 4 s thresholds and are kinder to the 5,000-event queue cap and to fingerprinting. Raw
  timings stay in the H1 device benchmark. Rejected: per-match histograms on `bot_match_finished` only. Abandoned
  and in-progress matches would lose their latency data, and that data is exactly what the slow-device cases
  produce.
- **Q-15 (SP2, 2026-10-07; sprint 4 planning) No crash SDK in Phase 1.** Q-1, Q-7 and threat-model item TM-10 stand
  for the whole of Phase 1, not only the playtest build. Crash-free sessions are measured by
  `app_opened.previous_exit_unclean` (S6a) plus Play vitals once the Play organisation account exists (TestFlight
  crash statistics on iOS when available). Rejected: adding Sentry now. It would reverse Q-1/Q-7 and TM-10, add a
  third-party processor (privacy policy and consent change) and spend bundle headroom (88.2 % used). ADR-0009
  (Sentry for clients) still applies from Phase 2. ICE: impact medium (better crash stacks) × confidence high ÷
  effort high (legal + consent + bundle) → no. Trade-off accepted: no stack traces in Phase 1; severity S1/S2 crashes
  are reproduced from owner reports and, after S6d, from match logs.
- **Q-16 (SP2, 2026-10-07) AC-19 remote config fetch deferred to a Stage 1 gate.** Bundled defaults only for the
  Stage 0 team dogfood (5–10 people, builds can ship daily, halt = fix build or expire build). Before Stage 1
  (≥ 30 external testers, ≤ 1 planned rebuild, playtest plan §3.4) the fetch and a remote kill switch must work.
  ICE: deferring saves a sprint-4 slice at low risk for a team-only cohort; it is not acceptable for Stage 1, where
  tuning and halting rely on remote config.
- **Q-17 (SP2, 2026-10-07) H1 device class.** An H1 result on the owner's phone is labelled "owner device" unless
  the phone meets the low-end reference class; reference measurements remain an owner ask. Timings come from the
  preview-only Diagnostics screen (DG1) on a release Hermes build, never a dev client (see "Device timings (H1)").
- `LEGAL_REVIEW_REQUIRED`: Senegal Law 2008-12 (prior declaration to the CDP? legal ground for the Senegal → EU
  transfer), validity of employee consent, retention periods above.

## Amendment SP2 (2026-10-07, sprint 4 task SP2)

Source: `docs/sprints/2026-10-07-phase1-dogfood-readiness.md` (decisions taken in planning) and the Q5 exit check
(`docs/sprints/2026-10-06-phase1-playtest-gates-exit-check.md`, finding S4). No AC changes meaning; the changes are
slicing, rollout and measurement method.

| Change | Where | Why |
|---|---|---|
| S6 split into S6a (consented queue, consent toggle, Settings, install id, `previous_exit_unclean`, `foreground_ms`; AC-17), S6b (survey; AC-18), S6c ("Send playtest data", `exportFormat: 1`; AC-17 export), S6d ("Send match log" + TM-04/05/07 sheet; AC-20 export) | Thin slices table, Flags table | Thin, independently reviewable slices; S6a–S6c are what make the three exit KPIs measurable (sprint 4 indicator 4) |
| "Send match log" moved from S3 to S6d | Thin slices, AC-20 note, Privacy notes, traceability, design §3.1/§5.8/§5.10.2/§10 | Q5 finding S4: the S3 PR had moved it (threat-model task P9) but the spec table had not |
| ACs column added to the slices table | Thin slices table | Every AC maps to a slice |
| New flag `playtest.match_log.enabled` (ASSUMPTION) and dark-launch reading of `analytics.upload.enabled` (ASSUMPTION) | Flags table | Each slice behind its own kill switch |
| H1 device class and method | "Device timings (H1)", Q-17 | The owner's phone may not be low-end; dev clients distort timings |
| AC-19 remote fetch not built; bundled defaults for Stage 0; remote kill switch is a Stage 1 gate | AC-19 note, Flags & rollout, Playtest distribution, Q-16 | Sprint 4 scope; Stage 0 is team-only |
| No crash SDK in Phase 1 | Exit criteria table, KPIs, Privacy notes, Q-15 | Keeps Q-1/Q-7 and TM-10 |

### Open questions raised by SP2

- **OQ-SP2-1 (product-strategist, qa-engineer).** The Stage 0 gate says "all slices S1–S6d behind flags on", but
  sprint 4 makes S4 a stretch and its success indicator 4 counts only S5 and S6a–S6c. May Stage 0 start without S4
  and/or S6d? Not changed here. Recommendation to discuss: S4 is not needed for a team dogfood if Strategist is
  covered before Stage 1 (playtest plan §0 already gates Stage 1 on it); S6d is strongly wanted because without it
  S1/S2 bug reports have no match log.
- **OQ-SP2-2 (data-analyst, mobile-engineer).** `analytics.upload.enabled` was defined as "stop uploads"; Phase 1
  has no upload. Confirm the dark-launch reading above (flag off = nothing recorded, playtest-data UI hidden), or
  introduce a separate recording flag.
- **OQ-SP2-3 (mobile-engineer, security-engineer).** Accept the new `playtest.match_log.enabled` flag for S6d, or
  gate S6d under an existing flag.
- **OQ-SP2-4 (data-analyst, mobile-engineer).** Does `previous_exit_unclean` count an OS low-memory kill in the
  background as unclean? If so, crash-free will read low on exactly the low-end Android devices we target. The
  definition belongs to the catalogue (`ANALYTICS_EVENTS.md`) and should be fixed in D1 before S6a.
  *D1 answer (2026-10-07, data-analyst + mobile-engineer recommendation; product owner decision pending):* **no**. The
  marker is on disk only while the app is `active`, so an OS kill (low-memory or other) or a swipe-away while the app
  is in the background or `inactive` is not an unclean exit; a crash, OS kill or power loss while active is. The
  definition is in the catalogue ("App lifecycle properties") and the pure model with its tests in
  `apps/mobile/src/analytics/session-marker.ts`. Reversible until S6a ships.
- **OQ-SP2-5 (data-analyst).** Crash-free is only recorded for consenting testers with S6a on, and only from the
  next launch. With no crash SDK and no Apple/Google org accounts yet, iOS crash-free in Stage 0 may rest on the
  unclean-exit flag alone. Confirm that this is acceptable for the Stage 0 gate (crash-free ≥ 99.0 %).
- **OQ-SP2-6 (security-engineer).** TM-07 says remote config "may only hide" the export address. With no remote
  config in Stage 0, TM-07 reduces to the build constant. Confirm that TM-07 can close in S6d and be re-checked when
  AC-19 is built for Stage 1. The threat model still says "S6" for TM-04/05/07; its owner should update it to
  S6c/S6d (not edited here).

## Test traceability

| AC | Test(s) |
|---|---|
| AC-1 | Maestro E2E fresh install → PLAY NOW → board interactive (no intermediate screens); perf benchmark cold start and tap→interactive on reference device; playtest metric time-to-first-match |
| AC-2 | Maestro E2E full match + summary + card in airplane mode; unit: no network call on gameplay path |
| AC-3 | Engine unit/property tests (E-1.1) for R-BOARD-001/002/004, R-BAG-001..003/005, R-CORE-001/004/005; app integration test asserting the match header: `engineRulesVersion` === `PLAY_RULES_VERSION`, layout and letter table of that version, format `untimed-vs-bot`, powers off, `lexiconVersion` and profile pinned, first player announced; unit test that `PLAY_RULES_VERSION` names a frozen (non-draft) registry version; flag test: `board.tech_squares.enabled` on and off give identical state hashes and identical rendering for a scripted match |
| AC-4 | Property tests R-SCORE-001..005/007/008, R-BAG-003/004 (E-1.1); component test: the score breakdown renders the engine breakdown verbatim in R-SCORE-008 order, with no tech-square line; golden scoring cases |
| AC-5 | Engine property P-SCORE-009-a..d and golden GC-SCORE-05 (E-1.1); component test: preview shown only on legal geometry, value equals the engine preview (premiums + Full Stack), no validity styling or wording, and the preview path never calls the lexicon (spy lexicon throws); flag on/off test |
| AC-6 | Engine tests R-TURN-002/003/005; Maestro rejection flow (tiles stay, still player's turn, reason with every offending form shown in EN/FR, scoreless counter unchanged) |
| AC-7 | Engine tests R-TURN-001/004 (incl. the "R-TURN-004 terminates" property, T-3), R-BAG-002/005/006, R-BOARD-004; component tests Exchange 1–7 tiles and disabled when bag < 7, blank picker, Pass confirmation |
| AC-8 | Bots contract test: observation contains no opponent rack/bag order (E-1.3); P-BOT-02/05 (determinism, node-count budget); perf test bot compute p95 on reference device; UI test responsiveness while thinking; schema test `bot_decision_made` |
| AC-9 | Component test selector + remembered choice; flag test hides personality, in-progress match continues |
| AC-10 | Engine tests R-SCORE-006/007, R-END-001..003 and end conditions; Maestro play-to-end with scripted seed; component test summary contents and actions; resign flow |
| AC-11 | Maestro: background/foreground, process kill mid-player-turn and mid-bot-turn, reboot (manual); unit: atomic persistence after each action; deterministic bot re-computation |
| AC-12 | Component test home resume card; Maestro new-match confirmation → `bot_match_abandoned` |
| AC-13 | Component test card contents and locale fallback; perf ≤ 300 ms open; Maestro summary → card → related → back → Play again; test card never auto-opens |
| AC-14 | Flag test: chips non-tappable, no entry point, summary unchanged |
| AC-15 | i18n lint (no hard-coded strings); snapshot tests EN/FR; pseudo-locale +30% length test |
| AC-16 | Accessibility audit (VoiceOver/TalkBack) checklist; component tests tap-to-place; reduced-motion snapshot; 200% text scale screenshots |
| AC-17 | Unit tests queue persistence, cap/drop, flush on connectivity, purge on consent off; schema tests for each event (zod); PII lint on event payloads |
| AC-18 | Component test survey shown at 1st and 3rd completion only, dismissible, non-blocking; flag off test |
| AC-19 | Unit tests flag resolution order (cached → bundled), background fetch non-blocking; Maestro `play_vs_bot.enabled` off with and without in-progress match. SP2: until the fetch is built, only the bundled-defaults path and the flag-off behaviour are tested; the cached-config and fetch tests are part of the Stage 1 gate |
| AC-20 | Engine replay test: stored action log → identical state hash (property test across seeds); manual export check for absence of PII. SP2: the export tests (TM-04 allowlist, schema and temp-file cleanup; TM-05 confirm sheet in EN/FR; TM-07 address allowlist) land with S6d |

## Review — game-designer (2026-10-02)

Scope: rules, scoring feel, bot feel, R-1. Rules changes are drafted in `docs/game/GAME_RULES.md` **v0.2 (draft)**;
testable properties and golden cases in `docs/game/RULE_PROPERTIES.md`. The spec text above is left unchanged;
the owner (`product-strategist`) folds these findings in.

### Answers to open questions

- **Q-3 → R-TURN-005, R-TURN-004 (amended).** Rejected attempts are not turns: they leave the state byte-identical
  and never count toward R-TURN-004, in **every** mode in v0.2 (not only casual). This removes the conflict between
  R-TURN-003 and R-TURN-004 and keeps the engine property "illegal action leaves state unchanged" absolute. Ranked
  anti-probing (`maxRejectionsPerTurn`) is reserved and inactive; to decide before E-2.4. AC-6 assumption confirmed.
- **Q-4 → R-CORE-004, R-CORE-005, R-MODE-CLASSIC-002.** First seat = uniform draw from a dedicated `first-player`
  RNG stream derived from the match seed (independent of the bag stream), announced before the first move. New
  format `untimed-vs-bot`: 1v1, no clock, powers off, free rejections, preview allowed, never ranked or rated; bot
  think delay is presentation only (outside the engine, so replays are delay-free). AC-3 assumption confirmed.
- **Q-5 → R-SCORE-009.** Preview confirmed as UI only and never authoritative, **with one correction**: the
  preview must omit every lexicon-dependent component (term bonus, tech-square bonus, chain bonus), not only skip
  the validity indicator. Otherwise a +16 expert bonus appearing in the preview tells the player the word is
  valid (and its difficulty) before commit. Preview = letter/word premiums + Full Stack, computed by the engine's
  scoring function with no lexicon access; the committed score adds the rest.
- **Q-6** Agree: in-match Knowledge Card off (related terms are hints).
- **Q-9** See R-1 below.
- Rules impact item 1 → **R-END-001** (going out); also **R-END-002** (resign/forfeit) and **R-END-003** (result,
  draws, tournament-only tie-break) so AC-10 can cite them. `bot_match_finished.end_reason` maps 1:1:
  `out` = R-END-001, `scoreless_turns` = R-TURN-004, `resign` = R-END-002.

### Findings

| # | Severity | Finding | Proposed fix |
|---|---|---|---|
| F-1 | **Blocking** | AC-5 as written lets the preview leak validity through lexicon-dependent bonuses. | Reword AC-5 to cite R-SCORE-009 (preview excludes term, tech-square and chain bonuses); component test: preview never calls the lexicon. |
| F-2 | **Blocking** | AC-3 says tech squares "as shipped by E-1.1", but no layout and no tech-square set exist (RULE_PROPERTIES A-02). An unsimulated tech-square layout in the first playtest confounds the fun signal. | Playtest build: Classic layout with standard premiums, **tech squares off** (flag `board.tech_squares.enabled`, default off) until E-1.6 simulates a layout. Needs the human's OK. |
| F-3 | **Blocking for playtest Stage 1 (not for design)** | R-1: the current seed is 310 playable forms with only 6 two-letter forms; see recommendation below. | Gate Stage 1 on E-1.6 diagnostics run on the bundled lexicon (thresholds below). |
| F-4 | Non-blocking | AC-4 breakdown order must follow R-SCORE-008 (base → tech → Compile → term → Full Stack/chain), each step floored; render the engine breakdown verbatim. | Cite R-SCORE-008 in AC-4. |
| F-5 | Non-blocking | AC-6 reason copy shows one `{word}`; a placement can form several invalid words. | Engine returns the list of offending forms (R-TURN-003); copy pluralises via ICU. |
| F-6 | Non-blocking | AC-7: Exchange must let the player pick 1–7 tiles (R-BAG-005); blank designation is permanent and visible to the opponent (R-BAG-006); first move needs ≥ 2 tiles on the start square (R-BOARD-004). | Add to AC-7 / coach mark copy. |
| F-7 | Non-blocking | AC-11 "bot recomputes the same move" requires the bot to draw only from its own `bot:<seat>` stream (R-CORE-005) and to be time-boxed by node count, not wall-clock, otherwise low-end devices will choose different moves. | Add to the E-1.3 contract. |
| F-8 | Non-blocking | Bot feel (AC-8/AC-9): personalities must differ by **behaviour**, not only strength. Beginner: picks among the top-N moves weighted toward short, novice/intermediate terms, never exchanges before turn 5, ignores leave quality, misses Full Stacks on purpose ~50%. Strategist: maximises score + rack-leave value, blocks open TW lanes when leading, exchanges when leave is poor, favours chain-extending terms. Both draw think time from a per-personality distribution (Beginner slower and more variable) so the pace reads as "human". | `ai-engineer` encodes as config; B-07 checks Beginner < Strategist ≥ 60%. |
| F-9 | Non-blocking | Human win-rate guardrails (vs Beginner ≥ 55%, vs Strategist 20–50%) are sensible; also track **average score margin** — a 30-point loss feels very different from a 200-point loss and drives "would play again". | Add `score_margin` (derivable from `bot_match_finished`) to the readout. |
| F-10 | Non-blocking | AC-10 "Draw (equal scores)" matches R-END-003; no tie-break in casual. | Cite R-END-003. |

**Fold-in status (product-strategist, sprint 3 SP1, 2026-10-04):**

| Finding | Folded into | Note |
|---|---|---|
| F-1 | AC-5, AC-5 tests | Cites R-SCORE-009; the preview omits term, tech-square and chain bonuses |
| F-2 | AC-3, Flags table, AC-3 tests | Tech squares off; flag `board.tech_squares.enabled` defaults off and cannot add tech squares at runtime. The human's OK is covered by GAME_RULES 0.3 §2.1 ("off for the Phase 1 playtest") and the sprint 3 deferral of tech squares |
| F-3 | E-1.7 AC-14 / KPIs (C-02, C-10, C-11) | Stage 1 gate is the sprint 3 batch-3 readout (AC-20 of E-1.7) |
| F-4 | AC-4 | R-SCORE-008 order, verbatim render |
| F-5 | AC-6 | Every offending form, ICU plural |
| F-6 | AC-7 | R-BAG-005, R-BAG-006, R-BOARD-004 |
| F-7 | AC-8, AC-11 | Per-decision stream, node-count budget |
| F-8 | — | Owned by bots-api §5 and the Strategist spec (ST0); no AC change |
| F-9 | KPIs, catalogue `bot_match_finished.score_margin` | |
| F-10 | AC-10 | R-END-003 |

### R-1 — minimum playable lexicon for a fun 15×15 Classic game (recommendation, not a decision)

Evidence (crude estimate, not the E-1.6 simulator; ignores board geometry): with the current 310 forms and a bag
derived from their letter frequency (33 vowels / 98 letters), a random 7-tile rack can form at least one term from
its own tiles 77% of the time (61% with half the lexicon, 29% with a fifth); with one letter borrowed from 5 random
board letters, 95%. So **letter feasibility is not the binding constraint; geometry and repetition are**:

1. **Two-letter forms drive board play.** Every cross-word of ≥ 2 letters must be a term (R-TURN-003). With only
   6 two-letter forms (AI, ML, CD, CI, IP, GO) parallel plays and hooks are nearly impossible, the board becomes a
   sparse crossword, premiums go unreachable and the bot often has no legal move late in the game. Target
   **≥ 30 two-letter forms** (OS, UI, UX, IO, IT, QA, PR, VM, DB, JS, PC, VR, AR, ID…, each a genuine tech term)
   and prefer vowel-bearing short forms.
2. **Share of short forms.** Target **≈ 20–25% of forms at 2–4 letters** (≥ 350 forms at 3–4 letters) for a
   lexicon of **≥ 1,500 playable forms minimum, 2,000+ preferred** for the 14-day playtest; below ~1,000 the same
   40–50 acronyms will dominate every game (repetition kills "would play again").
3. **Inflections are the cheapest multiplier.** Allowing plural/verb forms of countable terms (APIS, PODS, BUGS,
   DEPLOYS) as derived playable forms roughly doubles hook opportunities without new definitions. This is a
   lexicon-policy decision (Knowledge Card mapping, "term" purity) for the human with `lexicon-curator`.
4. **Letter distribution.** Keep deriving it from the lexicon (R-BAG-001): tech vocabulary is consonant-heavy and
   acronyms make consonant racks playable, so forcing English word-game vowel ratios (≈ 43%) would mismatch the
   vocabulary. Re-derive and re-simulate whenever the lexicon grows by > 20%. Blank count (2 ⚙) is a sim variant
   (3 blanks) only if diagnostics fail, not a default change.
5. **Smaller board for casual vs bot.** Prepare an **11×11 board with a ~60-tile bag** ("Quick Classic") as an
   E-1.6 **simulation variant**, not a shipped mode. Decision rule proposed for Stage 1: if on the bundled lexicon
   the 15×15 baseline shows R-TURN-004 endings > 10%, turns with no legal PlaceWord > 15%, or top-20 terms > 40% of
   words played, ship the 11×11 variant behind a flag for the playtest; otherwise keep full Classic as the spec
   decided. 11×11 also shortens matches (R-2) but reduces premium/strategy depth, so it should not become ranked
   Classic.

### Decisions for the human

- Accept GAME_RULES v0.2 draft (in particular the R-TURN-004 amendment: threshold 3 × nSeats, rejections excluded).
- Tech squares off for the E-1.5 playtest (F-2).
- Lexicon target for Stage 1 (≥ 1,500 / 2,000 forms, ≥ 30 two-letter forms) and inflection policy (R-1 §2–3).
- Whether the 11×11 Quick Classic fallback may ship for the playtest under the decision rule above (R-1 §5).
- Letter values for the bundled lexicon: fixed default table vs derived (RULE_PROPERTIES A-01); any BALANCE.md change.
- Start square DW vs plain (R-BOARD-004) once B-01 simulation is available.
