# Analytics Event Catalogue

Owner: `data-analyst`. No event may be emitted without an entry here. Competitive facts (scores, results,
ratings) come from **server** events (`match.*`, `progression.*`), never from client analytics.

Conventions: `object_action` snake_case · properties snake_case · every event carries `event_id`, `occurred_at`,
`user_id` (pseudonymous), `session_id`, `app_version`, `platform`, `locale`, `schema_version`.
PII class: `none` · `pseudonymous` · `personal` (needs consent/legal basis noted in DATA_MAP).

| Event | Trigger | Properties | PII | Owner | v |
|---|---|---|---|---|---|
| `app_opened` | App foregrounded | `cold_start_ms`, `network_type`, `previous_exit_unclean` *(v2)* | pseudonymous | mobile-engineer | 2 |
| `onboarding_step_completed` | FTUE step done | `step`, `duration_ms` | pseudonymous | mobile-engineer | 1 |
| `match_queue_joined` | Player enters a queue | `mode`, `format`, `region`, `ranked` | pseudonymous | realtime-engineer | 1 |
| `match_queue_left` | Leaves before match | `mode`, `wait_ms`, `reason` | pseudonymous | realtime-engineer | 1 |
| `match_started` (server) | Match created | `match_id`, `mode`, `format`, `opponent_type` (human/bot), `bot_personality` | pseudonymous | game-engine-engineer | 1 |
| `match_finished` (server) | Match ends | `match_id`, `result`, `score`, `duration_ms`, `words_played`, `powers_used` | pseudonymous | game-engine-engineer | 1 |
| `word_played` (server) | Valid word applied | `match_id`, `term_id`, `category`, `difficulty`, `points`, `think_ms` | pseudonymous | game-engine-engineer | 1 |
| `term_discovered` (server) | First time a player plays/sees a term | `term_id`, `category`, `difficulty` | pseudonymous | backend-engineer | 1 |
| `knowledge_card_opened` | Card displayed | `term_id`, `source` (post_word/post_match/graph) | pseudonymous | mobile-engineer | 1 |
| `knowledge_graph_navigated` | Node tapped in graph | `from_term_id`, `to_term_id`, `relation` | pseudonymous | mobile-engineer | 1 |
| `daily_started` / `daily_completed` | Daily flow | `daily_number`, `score`, `rank` | pseudonymous | backend-engineer | 1 |
| `power_used` (server) | Tech Power activated | `match_id`, `power`, `turn` | pseudonymous | game-engine-engineer | 1 |
| `mission_completed` / `achievement_unlocked` (server) | Progression | `mission_id`/`achievement_id` | pseudonymous | backend-engineer | 1 |
| `store_viewed` / `purchase_started` / `purchase_completed` (server-confirmed) | Commerce | `sku`, `price_minor`, `currency` | pseudonymous | backend-engineer | 1 |
| `share_card_created` | Victory shared | `match_id`, `channel` | pseudonymous | mobile-engineer | 1 |
| `coach_insight_shown` / `coach_challenge_started` | Coach | `insight_type`, `category` | pseudonymous | ai-engineer | 1 |
| `report_submitted` | Player reports cheating/abuse | `reason`, `context` | pseudonymous | security-engineer | 1 |

### App lifecycle properties (detail)

| Event · property | Type | Definition |
|---|---|---|
| `app_opened.previous_exit_unclean` *(v2)* | boolean, cold start only | `true` when the "session open" marker was still present at this cold start, i.e. the previous process ended while the app was user-facing: a crash, an OS kill or a power loss in the foreground, **including during startup**. The marker is always written at launch (the app has no background modes, so every cold start is user-initiated); until the app has been `active` once only `background` removes it (iOS passes through `inactive` while launching, and a boot crash must count); after that it is written whenever the app becomes `active` and removed whenever it moves to `background` or `inactive` (React Native `AppState`). A process that ends while the app is in the background, or `inactive` after use, is **not** unclean: an OS low-memory kill of a backgrounded app (routine on low-end Android), a swipe-away from the recent apps or the iOS app switcher, a reboot with the app in the background. Accepted blind spots: a crash while backgrounded (Play vitals cover it) and a crash while `inactive` after use (notification centre, control centre, call banner). The value is decided at launch and carried by the first `app_opened` of the process. `false` on a first launch. Pure model, S6a contract and tests: `apps/mobile/src/analytics/session-marker.ts`. Mechanism: `docs/architecture/notes/mobile-app-foundation.md` §6. Feeds local crash-free sessions (E-1.5 KPIs, playtest plan §4.1). *(D1, 2026-10-07, OQ-SP2-4: recommendation of data-analyst and mobile-engineer, "an OS kill in the background is not a crash"; product owner decision pending, reversible before S6a ships)* |
| `app_backgrounded.foreground_ms` | integer ≥ 0 | Milliseconds the app was in the foreground since the matching `app_opened` (or the last return to the foreground). Monotonic clock, not wall clock. Feeds session length (E-1.5 Q-12: a session closes after 30 min in background; length = sum of foreground intervals) |

## Client-local playtest events (E-1.5, Phase 1)

Emitted by `apps/mobile` in the offline playtest build only. They are written to the on-device queue and leave the
device only through the tester's "Send playtest data" share (E-1.5 AC-17). They are **non-competitive**: never
consumed by rating, progression or integrity pipelines, and never imported into any competitive history (E-1.5
Q-10). Server-side Phase 2 equivalents are the server events above; the `bot_` prefix keeps the two apart.

**PII.** Every property below is class `none`: no free text, no played string (E-1.5 Q-8), no device identifier
and no location. Each event is class `pseudonymous` as a whole, only because the standard envelope carries the
install-scoped random `user_id` (E-1.5 "Events"; reset on reinstall). That matches every other client event.

**Retention (all events in this section, and the two app lifecycle properties above while in the playtest build).**
The queue keeps events on device until the tester confirms "Sent", for at most 30 days, capped at 5,000 events
(oldest dropped first, drop count reported). Exported raw files are deleted 6 months after the playtest ends;
aggregates are kept. The legal basis is consent. Source: `docs/compliance/DATA_MAP.md`, row "playtest install
UUID + analytics events (E-1.5)". Withdrawing consent purges the queue (AC-17).

**Validation.** Each event has a zod schema in the app (AC-17 tests). Enums are closed: an unknown value fails
validation and the event is dropped and counted, never sent with free text.

**Schema contract (sprint 4 D1).** The zod schemas live in `apps/mobile/src/analytics/events.ts`, and
`apps/mobile/src/analytics/catalogue.test.ts` fails when they and this section disagree on event names, versions,
property names, types or required/optional. So the property types in the two tables below follow a fixed grammar:

- `uuid`: random UUID v4. `bool`. `int`: safe integer, no bound; `int ≥ N`; `int A–B` (both bounds inclusive).
- `` `a`/`b` ``: closed enum of the listed values (one value = a constant).
- `enum`: closed enum whose values are given elsewhere: in the referenced event, in the bucket lists below, or in
  `packages/lexicon` (categories in `data/categories.json`, `DIFFICULTIES`, `RELATION_TYPES`).
- `set of` `` `a`/`b` ``: array of distinct enum values. `string, 16 hex`: `^[0-9a-f]{16}$`.
- `canonical id`: a lexicon term id (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars). `string id`: an operator-chosen
  identifier (`^[a-z0-9][a-z0-9_-]{0,63}$`), never free text.
- Every property is required unless its type says `optional`. Text after `;` is commentary.

Wire form of one event (queue and export): `{ event, schema_version, event_id, occurred_at, user_id, session_id,
app_version, platform, locale, properties: { … } }`, all keys required, unknown keys rejected at both levels.
`schema_version` is the `v` column; `occurred_at` is an ISO 8601 UTC timestamp from the device clock; `platform` is
`ios`/`android`; `user_id` is the install-scoped random id; `session_id` is a random UUID v4 per process (new at
each cold start), a grouping key only: readout sessions follow Q-12 (below), not `session_id`. The export file wraps the events in the envelope
`exportFormat: 1` (`apps/mobile/src/export/playtest-data.ts`), which also carries the export time, so there is no
per-event `uploaded_at` (the E-1.5 "Events" ASSUMPTION is met at file level).

**Reused catalogue events: typed properties for the E-1.5 client.** The main table above names these properties;
this table gives their types for the playtest build (same grammar, same retention and PII as the table below).

| Event | Properties (type) | v |
|---|---|---|
| `app_opened` | `cold_start_ms` (int ≥ 0, optional; present on a cold start only), `network_type` (`wifi`/`cellular`/`other`/`none`/`unknown`; `unknown` until the app reads the network state), `previous_exit_unclean` (bool, optional; present on a cold start only, definition in "App lifecycle properties") | 2 |
| `onboarding_step_completed` | `step` (`first_launch`/`home_seen`/`play_now_tapped`/`first_move`/`coach_mark_1`/`coach_mark_2`/`coach_mark_3`/`first_match_completed`), `duration_ms` (int ≥ 0; ms since the previous step in the same process, monotonic clock; 0 for `first_launch` or when the previous step was in another process) | 1 |
| `knowledge_card_opened` | `term_id` (canonical id), `source` (`post_word`/`post_match`/`graph`) | 1 |
| `knowledge_graph_navigated` | `from_term_id` (canonical id), `to_term_id` (canonical id), `relation` (enum; lexicon relation type) | 1 |

`app_opened` fires on every move to the foreground (main-table trigger). A cold start (a new process) carries
`cold_start_ms` and `previous_exit_unclean`; a warm return to the foreground carries neither (the schema rejects one
without the other).

| Event | Trigger | Properties (type) | PII | Owner | Retention | v |
|---|---|---|---|---|---|---|
| `app_backgrounded` | App leaves the foreground (OS background transition) | `foreground_ms` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default (above) | 1 |
| `bot_match_started` | Local match vs bot created (E-1.5 AC-3) | `local_match_id` (uuid), `mode` (`classic`), `format` (`untimed-vs-bot`), `bot_personality` (`beginner`/`strategist`), `first_player` (`player`/`bot`), `lexicon_version` (string, 16 hex), `engine_rules_version` (int ≥ 1; the `PLAY_RULES_VERSION` pinned in the header), `bot_version` (int ≥ 1; `BOT_VERSION`), `is_first_match` (bool) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_match_finished` | Local match ends (R-END-001, R-TURN-004 or R-END-002) | `local_match_id` (uuid), `bot_personality` (enum; values of `bot_match_started`), `bot_version` (int ≥ 1), `engine_rules_version` (int ≥ 1), `result` (`win`/`loss`/`draw`, from the player's side), `end_reason` (`out` = R-END-001 / `scoreless_turns` = R-TURN-004 / `resign` = R-END-002), `player_score` (int, final, may be negative), `bot_score` (int, final, may be negative), `score_margin` (int = `player_score − bot_score`, signed; F-9), `bag_count_at_end` (int 0–100; tiles left in the bag when the match ended; b2-response T-9, C-10 split 0 / 1–6 / ≥ 7), `tiles_on_board_at_end` (int 0–100; C-11), `forced_pass_tail` (int ≥ 0; trailing consecutive Pass turns, both seats, taken while the bag held < 7 tiles; 0 unless `end_reason` = `scoreless_turns`; P-1 input), `active_duration_ms` (int ≥ 0), `turns` (int ≥ 0), `words_played` (int ≥ 0), `rejected_attempts` (int ≥ 0), `exchanges` (int ≥ 0), `passes` (int ≥ 0), `resume_count` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_match_abandoned` | In-progress match discarded | `local_match_id` (uuid), `reason` (`replaced_by_new`/`version_mismatch`/`state_corrupt`), `turns` (int ≥ 0), `active_duration_ms` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_match_resumed` | Match restored after background or cold start (AC-11), or a cold-start restore that failed (then `bot_match_abandoned` follows with `state_corrupt` or `version_mismatch`) | `local_match_id` (uuid), `resume_source` (`background`/`cold_start`), `away_ms` (int ≥ 0), `restore_ms` (int ≥ 0), `restore_path` (`in_memory`/`snapshot`/`full_replay`/`failed`; threat model TM-10: `in_memory` iff `resume_source` = `background` (the process kept the state); on a cold start, `snapshot` or `full_replay` = `RestorePath` of `persistence/resume.ts`, `failed` = no state rebuilt) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_decision_made` | The bot's decision is applied by the engine (one per bot turn; also after a resume recomputation, AC-11) | `local_match_id` (uuid), `action_index` (int ≥ 0; actions in the log before this decision, the `n` of the `bot:<seat>:<n>` stream), `bot_personality` (enum; values of `bot_match_started`), `bot_version` (int ≥ 1), `engine_rules_version` (int ≥ 1), `compute_ms_bucket` (enum, below; `chooseAction` wall time on device), `total_ms_bucket` (enum, below; bot turn start → move rendered, think delay included), `budget_exhausted` (bool; `BotDecision.budgetExhausted`, BOT-4), `nodes_used_bucket` (enum, below; `BotDecision.nodesUsed`), `automaton` (`gaddag`/`dawg`; BOT-8), `action_kind` (`place_word`/`exchange`/`pass`), `fallback` (bool; BOT-6 rule-correct fallback used), `recomputed` (bool; decision recomputed after a resume) | pseudonymous (properties: none) | mobile-engineer (fields from `BotDecision`, owned by ai-engineer) | playtest default | 1 |
| `bot_word_played` | Valid word applied locally (player or bot) | `local_match_id` (uuid), `actor` (`player`/`bot`), `term_id` (canonical id), `form_kind` (`canonical`/`plural`/`verb_s`/`verb_ed`/`verb_ing`; E-1.7), `category` (enum; the term's primary lexicon category), `difficulty` (enum; lexicon difficulty), `points` (int ≥ 0), `bonus_flags` (set of `term`/`full_stack`/`chain`/`tech_square`; `tech_square` never set while tech squares are off), `think_ms` (int ≥ 0), `turn` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `word_rejected` | Player's PLAY rejected by the engine | `local_match_id` (uuid), `reason` (`not_in_lexicon`/`placement`/`cross_word`), `word_length` (int 1–15), `think_ms` (int ≥ 0), `turn` (int ≥ 0). The attempted form is excluded (E-1.5 Q-8) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `match_summary_action` | Action tapped on the summary | `local_match_id` (uuid), `action` (`play_again`/`change_opponent`/`home`/`discover`), `ms_on_summary` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `knowledge_card_closed` | Card dismissed | `term_id` (canonical id), `source` (`post_match`/`graph`), `dwell_ms` (int ≥ 0), `related_taps` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `playtest_survey_answered` | One-tap survey answered or dismissed | `survey_id` (string id), `question_id` (`would_play_again`), `answer` (`yes`/`maybe`/`no`/`dismissed`), `matches_completed` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `playtest_survey_shown` | One-tap survey displayed on the summary (E-1.5 AC-18; at most twice per install) | `survey_id` (string id), `question_id` (`would_play_again`), `matches_completed` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `analytics_buffer_flushed` | Queue exported through "Send playtest data" (AC-17) | `events_sent` (int ≥ 0), `events_dropped_since_last` (int ≥ 0), `oldest_event_age_ms` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |

**Latency and node buckets** (lower bound inclusive, upper bound exclusive; closed enums):

- `compute_ms_bucket`, `total_ms_bucket`: `lt_250`, `250_500`, `500_1000`, `1000_1500`, `1500_2000`, `2000_3000`,
  `3000_4000`, `ge_4000`. The 2,000 and 4,000 ms edges are the E-1.5 AC-8 thresholds (Strategist compute p95 ≤ 2 s,
  total p95 ≤ 4 s). The 1,000 ms edge is the bots-api Q-A1 trigger.
- `nodes_used_bucket`: `lt_1k`, `1k_10k`, `10k_50k`, `50k_100k`, `100k_200k`, `ge_200k`. It brackets the
  Strategist provisional budget (≈ 70,000 nodes, sprint 3) and Beginner's 200,000 cap. Read together with
  `compute_ms_bucket`, it gives a coarse on-device `c_node` cross-check for H1.

**Data-analyst notes (sprint 3 SP1).**

- `bot_match_started.engine_version` from the E-1.5 proposal is named `engine_rules_version` here: it is the
  `engineRulesVersion` integer of ADR-0013 §D5, pinned by `PLAY_RULES_VERSION`. No build ever emitted the old name.
- The score margin lives on `bot_match_finished`, the event that ends a local match. There is no `match_ended`
  event. The server `match_finished` carries only `score`, and a Phase 2 margin on it is out of scope here.
- `bot_personality`, `bot_version` and `engine_rules_version` are repeated on `bot_match_finished` and
  `bot_decision_made`, so these events stay readable when the queue cap has dropped `bot_match_started`.
- Volume: about 80 events per match (≈ 45 `bot_word_played`, ≈ 28 `bot_decision_made`, plus lifecycle). The
  5,000-event cap therefore holds about 60 matches between exports. ASSUMPTION: most testers play 3–20 matches per
  week (E-1.5 target ≥ 3), so the cap is enough for them, but heavy players need the export reminder (playtest plan
  T+7). Watch `events_dropped_since_last`.
- Readout definitions that use these fields:
  - `score_margin` (playtest plan §4.1);
  - C-10 on humans = share of `end_reason = scoreless_turns` with `bag_count_at_end ≥ 7`;
  - C-11 on humans = mean `tiles_on_board_at_end`;
  - bot latency p95 per personality, read from bucket counts against the AC-8 edges;
  - BG-5 on device = share of `budget_exhausted = true`.

**Data-analyst notes (sprint 4 D1; answers playtest plan OQ-3).**

- `app_backgrounded.foreground_ms` and `app_opened.previous_exit_unclean` are accepted as the way to measure
  session length and local crash-free. No other mechanism is needed in Phase 1.
- Ordering: events of one install are ordered by their position in the export files (the queue is append-only and
  exported oldest first; files in `exportedAt` order). `occurred_at` (device clock, may jump) is used only to place
  intervals in time and to measure background gaps, never to reorder events.
- Session reconstruction, per install: each `app_backgrounded` closes one foreground interval
  `[occurred_at − foreground_ms, occurred_at]`; an interval is **open** from an `app_opened` until its
  `app_backgrounded`. Intervals separated by ≤ 30 min of background are one session (Q-12); session length = sum of
  `foreground_ms`. `session_id` is not used for this.
- Crash attribution: a cold start with `previous_exit_unclean = true` ends the session holding the open interval, if
  there is one; that interval is closed at the last event recorded before the cold start (a lower bound, because a
  crash leaves no `app_backgrounded`). If there is no open interval (the previous session ended cleanly and the
  crashed process recorded nothing, e.g. a boot crash), it counts as a separate **zero-length crashed session**: it
  enters the crash-free rate and is left out of session length.
- Crash-free sessions = 1 − (sessions ended by an unclean exit ÷ sessions), per platform. A session with no later
  cold start in the export has an unknown outcome: it is left out of the rate and its count is reported.
- Survey answer rate (S6b) = `playtest_survey_answered` with `answer` ≠ `dismissed` ÷ `playtest_survey_shown`; dismiss rate = `answer = dismissed` ÷ shown; the rest were ignored (the survey never
  blocks Play again, AC-18). `playtest_survey_shown` was added for this: without it "shown" was not computable.

### Privacy-compliance FYI (sprint 3 SP1; review requested, not a blocker for schema work)

| Who | Reviews what | Expected outcome |
|---|---|---|
| `privacy-compliance` | New fields are within the existing DATA_MAP row "playtest install UUID + analytics events (E-1.5)": same purpose (playtest KPIs), same consent basis, same retention. No new data category, no new processor, no personal property | Confirm: no DATA_MAP change. If counsel disagrees, add a sub-row |
| `privacy-compliance` | The privacy notice "data list" (E-1.5 Privacy notes) and the AC-17 export summary screen must now mention: foreground time per session, an unclean-exit (crash) marker, and bot performance timings in coarse buckets | Notice and export-screen copy updated before Stage 1 (`ux-ui-designer` for copy) |
| `privacy-compliance` | The unclean-exit marker is a small on-device file read at launch (ePrivacy Art. 5(3) storage access). The enrolment consent already covers on-device storage (E-1.5 Q-7) | Confirm it is covered; otherwise a wording change in consent v1 (counsel batch, D0+3 human ask) |
| `privacy-compliance` + `data-analyst` | Fingerprinting risk of bucketed latency × `platform` × `app_version` in a cohort of ~40 testers | Expected: acceptable (coarse buckets, no device model, consented adults); record the conclusion |
| `data-analyst` | Schemas, enum values, bucket edges, queue-cap arithmetic, readout definitions above | Sign-off on this section (sprint 3 SP1 acceptance) |
| `mobile-engineer`, `ai-engineer` | Zod schemas and emission points; `BotDecision` fields (`nodesUsed`, `budgetExhausted`, automaton) exposed to the host | Implemented in S1/S2/S6 |

## Changelog

- 2026-10-16 (sprint 4 EV, `mobile-engineer`; first build that emits the gameplay events; no schema or version
  change):
  - Emission points (`apps/mobile/src/match/match-telemetry.ts`, driven by `match/match-session.tsx`, run after the
    move is committed and rendered, never before it): `bot_match_started` when a match is created (PLAY NOW, Play
    again, New match, Start a new match); `bot_word_played` per applied word, both seats; `bot_decision_made` per
    applied bot decision; `word_rejected` per rejected PLAY; `bot_match_finished` when the engine ends the match;
    `bot_match_abandoned` `replaced_by_new` when a new match replaces an open one, `version_mismatch` /
    `state_corrupt` when the cold-start restore fails (once per `local_match_id`, after `bot_match_resumed` with
    `restore_path` = `failed`); a match whose final move was saved but whose analytics did not run (process killed
    in between) gets its `bot_match_finished` at the next cold start, rebuilt from the last finished match on the
    device, once; `bot_match_resumed` on a return from the background with a match open (`in_memory`)
    and when the saved match is restored at a cold start (`snapshot` / `full_replay`); `match_summary_action` on Play
    again, Home and "Discover" (Change opponent does not exist before S4); `onboarding_step_completed` from the
    recorder and Home (below).
  - Definitions chosen (ASSUMPTIONS, reversible, for `data-analyst` sign-off): `turns` = the engine's `turnNumber`
    (PLACE_WORD, EXCHANGE and PASS of both seats; RESIGN is not a turn); `words_played`, `exchanges`, `passes` count
    both seats (per seat: `bot_word_played.actor`); `rejected_attempts` counts every rejected PLAY while
    `word_rejected` is capped at 10 per turn and 30 per match (PLAY stays enabled on a rejected placement, D-5);
    `word_rejected.word_length` = length of the attempted main word from the engine's lexicon-free preview, else the
    number of tiles placed; `turn` on `bot_word_played` / `word_rejected` = `turnNumber` before the move;
    `think_ms` = foreground time from the start of the player's turn (previous move rendered) to PLAY, and the bot's
    compute time for its words; `active_duration_ms` = foreground time while the match is open and in progress on
    this process (a crash loses the interval since the last background: a lower bound); `compute_ms_bucket` = start
    of the bot's search (after the runner's frame wait, so neither the frame yield of P5 option A nor the previous
    move's analytics work counts) to its decision; `total_ms_bucket` = bot request (its turn rendered) to its move
    rendered, think delay included; cold-start `away_ms` = device wall clock since the match last went to the
    background (or started): after a crash, with no background before it, the time played since then counts as away,
    so it is an upper bound (the record keeps only that time, as the privacy policy discloses); `ms_on_summary` = from the first time the Summary of that match was shown
    (a remount of the Summary does not restart it); `automaton` = what
    `@codelex/bots` selects for the bundled index (BOT-8); `fallback` = the bot chose no word (exact for Beginner,
    the only playtest bot; `BotDecision` must expose BOT-6 before Strategist ships in S4); `is_first_match` = no
    finished match on the device, no open match record before it, and no match started earlier on this process
    under the current install id (nothing is kept on the device between matches for it).
  - Consent withdrawn then given again in the same process: everything the app held for the open match (its
    `local_match_id`, counters, clocks, the last Summary) is dropped with the old install id; the open match adopts a
    new `local_match_id` with zero counters at its next event, like a match on which recording was turned on
    mid-match (no `bot_match_started`).
  - No sampling: the per-match volume budget above (about 80 events per match) stands.
  - `onboarding_step_completed`: `first_launch` (the recorder's start on an install with neither a consent choice nor
    an install id; its `occurred_at` is that start, and it is written just before the next step, so a boot that never
    reaches Home leaves nothing), `home_seen` (Home mounted), `play_now_tapped` (PLAY NOW), `first_move` (the player's first applied action; the bot's opening move does not
    count),
    `first_match_completed` (first match end); each once per install, only on an install whose first launch was
    recorded. `coach_mark_1` to `coach_mark_3` are **not applicable in Phase 1**: the coach marks do not exist
    (D-26, no copy may ship before drag-to-place), so they are never emitted.
  - Write budget: the match record is written at start, on each emitted `word_rejected` (so at most 30 times per
    match for rejections), on background, resume and end; a capped rejection only counts in memory and is written
    with the next move, background or end. No write per move otherwise.
  - New on-device files (backup-excluded data directory, purged with consent off, never exported):
    `analytics.play` (the open match's random `local_match_id`, its counters, a CRC-32 of its seed to bind it to the
    saved match and the phone-clock time it last went to the background; deleted when the match ends) and
    `analytics.onboarding` (steps done). No new data category leaves the device.

- 2026-10-07 (sprint 4 D1, `mobile-engineer` with `data-analyst`; no build has emitted these events yet, so no
  version bump):
  - "Schema contract" paragraph: type grammar, wire form, zod schemas frozen against this section by a test.
  - Count and duration properties typed `int ≥ 0`, versions `int ≥ 1`, `word_rejected.word_length` `int 1–15`,
    `term_id` typed `canonical id` everywhere; `bot_score` may be negative like `player_score`. Types tightened; no
    emitted data affected (nothing has been emitted yet).
  - `bot_match_resumed.restore_path` added (threat model TM-10), with `in_memory` for background resumes.
  - New event `playtest_survey_shown` (S6b answer rate).
  - New table of typed properties for the reused events (`app_opened`, `onboarding_step_completed`,
    `knowledge_card_opened`, `knowledge_graph_navigated`); `cold_start_ms` and `previous_exit_unclean` present on cold
    starts only; `network_type` values.
  - `previous_exit_unclean`: a crash during startup counts; an OS kill or swipe-away while the app is in the
    background or `inactive` after use is not an unclean exit (OQ-SP2-4 recommendation; product owner decision
    pending).
  - `session_id` defined as per process. Data-analyst notes D1: ordering, session, crash attribution and crash-free
    reconstruction (answers playtest plan OQ-3); survey answer rate.

- 2026-10-04 (sprint 3 SP1, `product-strategist` drafting for `data-analyst`):
  - `app_opened` v2 adds `previous_exit_unclean`.
  - New section "Client-local playtest events (E-1.5)" with `app_backgrounded`, `bot_decision_made` and the E-1.5
    proposed events, which were accepted with these changes:
    - `engine_version` renamed `engine_rules_version`;
    - `bot_match_finished` gains `score_margin`, `bag_count_at_end`, `tiles_on_board_at_end`,
      `forced_pass_tail` and its personality and version fields;
    - `bot_word_played` gains `form_kind`.
  - Retention and PII stated per section; privacy-compliance FYI added.
