# Analytics Event Catalogue

Owner: `data-analyst`. No event may be emitted without an entry here. Competitive facts (scores, results,
ratings) come from **server** events (`match.*`, `progression.*`), never from client analytics.

Conventions: `object_action` snake_case · properties snake_case · every event carries `event_id`, `occurred_at`,
`user_id` (pseudonymous), `session_id`, `app_version`, `platform`, `locale`, `schema_version`.
PII class: `none` · `pseudonymous` · `personal` (needs consent/legal basis noted in DATA_MAP).

| Event | Trigger | Properties | PII | Owner | v |
|---|---|---|---|---|---|
| `app_opened` | App foregrounded | `cold_start_ms`, `network_type` | pseudonymous | mobile-engineer | 1 |
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
