/**
 * Test support (not shipped: nothing in the app imports it). One valid sample of every E-1.5 event, for schema tests
 * now and for the S6a recorder and the readout (sprint 4 KR) later.
 */
import type { AnalyticsEvent, EventName } from './events.ts';

export const INSTALL_ID = '3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f';
const SESSION_ID = '7d9e2f10-4a3b-4c5d-9e8f-0a1b2c3d4e5f';
const MATCH_ID = 'b4c3d2e1-f0a9-4b8c-9d7e-6f5a4b3c2d1e';

/** Event `n` gets a distinct, valid v4 id. */
export const eventId = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const PROPERTIES: {
  readonly [N in EventName]: Extract<AnalyticsEvent, { event: N }>['properties'];
} = {
  app_opened: { cold_start_ms: 1840, network_type: 'none', previous_exit_unclean: false },
  onboarding_step_completed: { step: 'first_move', duration_ms: 5200 },
  knowledge_card_opened: { term_id: 'api', source: 'post_match' },
  knowledge_graph_navigated: { from_term_id: 'api', to_term_id: 'rest', relation: 'related_to' },
  app_backgrounded: { foreground_ms: 600_000 },
  bot_match_started: {
    local_match_id: MATCH_ID,
    mode: 'classic',
    format: 'untimed-vs-bot',
    bot_personality: 'beginner',
    first_player: 'player',
    lexicon_version: '0123456789abcdef',
    engine_rules_version: 1,
    bot_version: 2,
    is_first_match: true,
  },
  bot_match_finished: {
    local_match_id: MATCH_ID,
    bot_personality: 'beginner',
    bot_version: 2,
    engine_rules_version: 1,
    result: 'win',
    end_reason: 'scoreless_turns',
    player_score: -4,
    bot_score: -10,
    score_margin: 6,
    bag_count_at_end: 3,
    tiles_on_board_at_end: 88,
    forced_pass_tail: 4,
    active_duration_ms: 900_000,
    turns: 40,
    words_played: 30,
    rejected_attempts: 2,
    exchanges: 1,
    passes: 5,
    resume_count: 1,
  },
  bot_match_abandoned: {
    local_match_id: MATCH_ID,
    reason: 'replaced_by_new',
    turns: 3,
    active_duration_ms: 30_000,
  },
  bot_match_resumed: {
    local_match_id: MATCH_ID,
    resume_source: 'cold_start',
    away_ms: 3_600_000,
    restore_ms: 120,
    restore_path: 'snapshot',
  },
  bot_decision_made: {
    local_match_id: MATCH_ID,
    action_index: 7,
    bot_personality: 'strategist',
    bot_version: 2,
    engine_rules_version: 1,
    compute_ms_bucket: '1000_1500',
    total_ms_bucket: '2000_3000',
    budget_exhausted: false,
    nodes_used_bucket: '50k_100k',
    automaton: 'gaddag',
    action_kind: 'place_word',
    fallback: false,
    recomputed: false,
  },
  bot_word_played: {
    local_match_id: MATCH_ID,
    actor: 'player',
    term_id: 'kubernetes',
    form_kind: 'canonical',
    category: 'devops',
    difficulty: 'intermediate',
    points: 24,
    bonus_flags: ['term', 'chain'],
    think_ms: 12_000,
    turn: 5,
  },
  word_rejected: {
    local_match_id: MATCH_ID,
    reason: 'not_in_lexicon',
    word_length: 5,
    think_ms: 8000,
    turn: 6,
  },
  match_summary_action: { local_match_id: MATCH_ID, action: 'play_again', ms_on_summary: 4000 },
  knowledge_card_closed: { term_id: 'api', source: 'graph', dwell_ms: 2500, related_taps: 1 },
  playtest_survey_shown: {
    survey_id: 'stage0',
    question_id: 'would_play_again',
    matches_completed: 1,
  },
  playtest_survey_answered: {
    survey_id: 'stage0',
    question_id: 'would_play_again',
    answer: 'yes',
    matches_completed: 1,
  },
  analytics_buffer_flushed: {
    events_sent: 412,
    events_dropped_since_last: 0,
    oldest_event_age_ms: 86_400_000,
  },
};

const VERSIONS: { readonly [N in EventName]: number } = {
  app_opened: 2,
  onboarding_step_completed: 1,
  knowledge_card_opened: 1,
  knowledge_graph_navigated: 1,
  app_backgrounded: 1,
  bot_match_started: 1,
  bot_match_finished: 1,
  bot_match_abandoned: 1,
  bot_match_resumed: 1,
  bot_decision_made: 1,
  bot_word_played: 1,
  word_rejected: 1,
  match_summary_action: 1,
  knowledge_card_closed: 1,
  playtest_survey_shown: 1,
  playtest_survey_answered: 1,
  analytics_buffer_flushed: 1,
};

/** A valid wire-form event of `name` (a plain object: tests mutate copies of it). */
export function sampleEvent(name: EventName, n = 1): Record<string, unknown> {
  return {
    event: name,
    schema_version: VERSIONS[name],
    event_id: eventId(n),
    occurred_at: '2026-10-07T09:30:00.000Z',
    user_id: INSTALL_ID,
    session_id: SESSION_ID,
    app_version: '0.1.0',
    platform: 'android',
    locale: 'fr-SN',
    properties: JSON.parse(JSON.stringify(PROPERTIES[name])) as unknown,
  };
}
