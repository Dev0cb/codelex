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
| `app_opened.previous_exit_unclean` *(v2)* | boolean | `true` when the "session open" marker written at the previous launch was still present at this launch, i.e. the previous process ended without a clean background or exit (crash, OS kill while foregrounded, power loss). Mechanism: `docs/architecture/notes/mobile-app-foundation.md` (unclean-exit flag). `false` on a first launch. Feeds local crash-free sessions (E-1.5 KPIs, playtest plan §4.1) |
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

| Event | Trigger | Properties (type) | PII | Owner | Retention | v |
|---|---|---|---|---|---|---|
| `app_backgrounded` | App leaves the foreground (OS background transition) | `foreground_ms` (int ≥ 0) | pseudonymous (properties: none) | mobile-engineer | playtest default (above) | 1 |
| `bot_match_started` | Local match vs bot created (E-1.5 AC-3) | `local_match_id` (uuid), `mode` (`classic`), `format` (`untimed-vs-bot`), `bot_personality` (`beginner`/`strategist`), `first_player` (`player`/`bot`), `lexicon_version` (string, 16 hex), `engine_rules_version` (int; the `PLAY_RULES_VERSION` pinned in the header), `bot_version` (int; `BOT_VERSION`), `is_first_match` (bool) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_match_finished` | Local match ends (R-END-001, R-TURN-004 or R-END-002) | `local_match_id` (uuid), `bot_personality` (enum), `bot_version` (int), `engine_rules_version` (int), `result` (`win`/`loss`/`draw`, from the player's side), `end_reason` (`out` = R-END-001 / `scoreless_turns` = R-TURN-004 / `resign` = R-END-002), `player_score` (int, final, may be negative), `bot_score` (int, final), `score_margin` (int = `player_score − bot_score`, signed; F-9), `bag_count_at_end` (int 0–100; tiles left in the bag when the match ended; b2-response T-9, C-10 split 0 / 1–6 / ≥ 7), `tiles_on_board_at_end` (int 0–100; C-11), `forced_pass_tail` (int ≥ 0; trailing consecutive Pass turns, both seats, taken while the bag held < 7 tiles; 0 unless `end_reason` = `scoreless_turns`; P-1 input), `active_duration_ms` (int), `turns` (int), `words_played` (int), `rejected_attempts` (int), `exchanges` (int), `passes` (int), `resume_count` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_match_abandoned` | In-progress match discarded | `local_match_id` (uuid), `reason` (`replaced_by_new`/`version_mismatch`/`state_corrupt`), `turns` (int), `active_duration_ms` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_match_resumed` | Match restored after background or cold start (AC-11) | `local_match_id` (uuid), `resume_source` (`background`/`cold_start`), `away_ms` (int), `restore_ms` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `bot_decision_made` | The bot's decision is applied by the engine (one per bot turn; also after a resume recomputation, AC-11) | `local_match_id` (uuid), `action_index` (int; actions in the log before this decision, the `n` of the `bot:<seat>:<n>` stream), `bot_personality` (enum), `bot_version` (int), `engine_rules_version` (int), `compute_ms_bucket` (enum, below; `chooseAction` wall time on device), `total_ms_bucket` (enum, below; bot turn start → move rendered, think delay included), `budget_exhausted` (bool; `BotDecision.budgetExhausted`, BOT-4), `nodes_used_bucket` (enum, below; `BotDecision.nodesUsed`), `automaton` (`gaddag`/`dawg`; BOT-8), `action_kind` (`place_word`/`exchange`/`pass`), `fallback` (bool; BOT-6 rule-correct fallback used), `recomputed` (bool; decision recomputed after a resume) | pseudonymous (properties: none) | mobile-engineer (fields from `BotDecision`, owned by ai-engineer) | playtest default | 1 |
| `bot_word_played` | Valid word applied locally (player or bot) | `local_match_id` (uuid), `actor` (`player`/`bot`), `term_id` (canonical id), `form_kind` (`canonical`/`plural`/`verb_s`/`verb_ed`/`verb_ing`; E-1.7), `category` (enum), `difficulty` (enum), `points` (int), `bonus_flags` (set of `term`/`full_stack`/`chain`/`tech_square`; `tech_square` never set while tech squares are off), `think_ms` (int), `turn` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `word_rejected` | Player's PLAY rejected by the engine | `local_match_id` (uuid), `reason` (`not_in_lexicon`/`placement`/`cross_word`), `word_length` (int), `think_ms` (int), `turn` (int). The attempted form is excluded (E-1.5 Q-8) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `match_summary_action` | Action tapped on the summary | `local_match_id` (uuid), `action` (`play_again`/`change_opponent`/`home`/`discover`), `ms_on_summary` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `knowledge_card_closed` | Card dismissed | `term_id`, `source` (`post_match`/`graph`), `dwell_ms` (int), `related_taps` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `playtest_survey_answered` | One-tap survey answered or dismissed | `survey_id` (string id), `question_id` (`would_play_again`), `answer` (`yes`/`maybe`/`no`/`dismissed`), `matches_completed` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |
| `analytics_buffer_flushed` | Queue exported through "Send playtest data" (AC-17) | `events_sent` (int), `events_dropped_since_last` (int), `oldest_event_age_ms` (int) | pseudonymous (properties: none) | mobile-engineer | playtest default | 1 |

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

- 2026-10-04 (sprint 3 SP1, `product-strategist` drafting for `data-analyst`):
  - `app_opened` v2 adds `previous_exit_unclean`.
  - New section "Client-local playtest events (E-1.5)" with `app_backgrounded`, `bot_decision_made` and the E-1.5
    proposed events, which were accepted with these changes:
    - `engine_version` renamed `engine_rules_version`;
    - `bot_match_finished` gains `score_margin`, `bag_count_at_end`, `tiles_on_board_at_end`,
      `forced_pass_tail` and its personality and version fields;
    - `bot_word_played` gains `form_kind`.
  - Retention and PII stated per section; privacy-compliance FYI added.
