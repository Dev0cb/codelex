/**
 * Zod schemas of the analytics events the E-1.5 playtest build emits (AC-17; sprint 4 D1). The catalogue
 * `docs/standards/ANALYTICS_EVENTS.md` ("Client-local playtest events") is the source of truth: `catalogue.test.ts`
 * fails when these schemas and the catalogue disagree on names, versions, properties, types or required/optional.
 *
 * Contract only: the consented queue that records these events is slice S6a. Every event is validated here before
 * it enters the queue; an invalid event is dropped and counted, never stored (catalogue "Validation").
 *
 * Portable on purpose: this module imports nothing but `zod/mini`, so plain Node (≥ 22.18, type stripping) can import
 * it, e.g. the data-analyst readout (sprint 4 task KR) and the TM-08 import tooling. `zod/mini` keeps the Hermes
 * bundle cost low (tree-shakable functional API). No property holds free text, a device identifier or a played string
 * (E-1.5 Q-8): every string is an enum, a UUID or matches a fixed pattern (tested).
 */
import * as z from 'zod/mini';

// --- Shared value schemas ---------------------------------------------------------------------------------------

/** Lexicon term id (`packages/lexicon/schema/term.schema.json`, `id`), capped at 64 characters. */
export const CANONICAL_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Operator-chosen identifier such as a survey id; never free text. */
export const STRING_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** App version as shown in Settings (`app.json` `version`). */
export const APP_VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,5}$/;
/** BCP 47 subset: language, optional script, optional region (`fr`, `fr-SN`, `zh-Hant-TW`). */
export const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;

const uuid = () => z.uuidv4();
const bool = () => z.boolean();
const int = () => z.int();
const intAtLeast = (min: number) => z.int().check(z.minimum(min));
const intBetween = (min: number, max: number) => z.int().check(z.minimum(min), z.maximum(max));
const canonicalId = () => z.string().check(z.maxLength(64), z.regex(CANONICAL_ID_PATTERN));
const stringId = () => z.string().check(z.regex(STRING_ID_PATTERN));
const hex16 = () => z.string().check(z.regex(/^[0-9a-f]{16}$/));
/** `set of` in the catalogue grammar: distinct values of a closed enum. */
const setOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).check(
    z.maxLength(values.length),
    z.refine((a) => new Set(a).size === a.length, 'duplicate value in set'),
  );

export const PLATFORMS = ['ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Must equal the ids of `packages/lexicon/data/categories.json` (tested; a new category needs a schema change). */
export const CATEGORY_IDS = [
  'programming',
  'systems',
  'networking',
  'cloud',
  'devops',
  'data',
  'ai',
  'cybersecurity',
  'hardware',
] as const;
/** `DIFFICULTIES` of `@codelex/lexicon/index` (tested). */
export const DIFFICULTY_IDS = ['novice', 'intermediate', 'advanced', 'expert'] as const;
/** `RELATION_TYPES` of `@codelex/lexicon/index` (tested). */
export const RELATION_IDS = [
  'is_a',
  'part_of',
  'uses',
  'related_to',
  'alternative_to',
  'runs_on',
  'implements',
] as const;
/** The personalities the playtest build offers (a subset of `BotPersonalityId`). */
export const BOT_PERSONALITIES = ['beginner', 'strategist'] as const;
/** Catalogue "Latency and node buckets": lower bound inclusive, upper bound exclusive. */
export const COMPUTE_MS_BUCKETS = [
  'lt_250',
  '250_500',
  '500_1000',
  '1000_1500',
  '1500_2000',
  '2000_3000',
  '3000_4000',
  'ge_4000',
] as const;
export const NODES_USED_BUCKETS = [
  'lt_1k',
  '1k_10k',
  '10k_50k',
  '50k_100k',
  '100k_200k',
  'ge_200k',
] as const;

// --- Event definition -------------------------------------------------------------------------------------------

/**
 * The standard envelope of `ANALYTICS_EVENTS.md` ("Conventions"). `user_id` is the install-scoped random id (reset on
 * reinstall, E-1.5 "Events"); `occurred_at` comes from the device clock and orders events within one install only.
 */
const ENVELOPE = {
  event_id: uuid(),
  occurred_at: z.iso.datetime(),
  user_id: uuid(),
  session_id: uuid(),
  app_version: z.string().check(z.regex(APP_VERSION_PATTERN)),
  platform: z.enum(PLATFORMS),
  locale: z.string().check(z.maxLength(16), z.regex(LOCALE_PATTERN)),
};

function defineEvent<
  const N extends string,
  const V extends number,
  P extends z.ZodMiniObject<z.core.$ZodLooseShape, z.core.$strict>,
>(event: N, version: V, properties: P) {
  const schema = z.strictObject({
    event: z.literal(event),
    schema_version: z.literal(version),
    ...ENVELOPE,
    properties,
  });
  return { event, version, schema } as const;
}

const props = <T extends z.core.$ZodLooseShape>(shape: T) => z.strictObject(shape);

// --- Reused catalogue events (typed for the E-1.5 client) ------------------------------------------------------

export const AppOpened = defineEvent(
  'app_opened',
  2,
  props({
    /** Present on a cold start (a new process) only. */
    cold_start_ms: z.optional(intAtLeast(0)),
    network_type: z.enum(['wifi', 'cellular', 'other', 'none', 'unknown']),
    /**
     * Cold start only. `true` iff the session marker of the previous process was still on disk: that process ended
     * while the app was `active` in the foreground (crash, OS kill, power loss). An OS kill (low-memory or other) or
     * a swipe-away while the app is in the background or `inactive` is NOT unclean (OQ-SP2-4 recommendation: a
     * background OS kill is not a crash). `false` on a first launch. Model: `session-marker.ts`.
     */
    previous_exit_unclean: z.optional(bool()),
  }).check(
    z.refine(
      (p) => (p.cold_start_ms === undefined) === (p.previous_exit_unclean === undefined),
      'cold_start_ms and previous_exit_unclean are both present (cold start) or both absent',
    ),
  ),
);

export const OnboardingStepCompleted = defineEvent(
  'onboarding_step_completed',
  1,
  props({
    step: z.enum([
      'first_launch',
      'home_seen',
      'play_now_tapped',
      'first_move',
      'coach_mark_1',
      'coach_mark_2',
      'coach_mark_3',
      'first_match_completed',
    ]),
    duration_ms: intAtLeast(0),
  }),
);

export const KnowledgeCardOpened = defineEvent(
  'knowledge_card_opened',
  1,
  props({ term_id: canonicalId(), source: z.enum(['post_word', 'post_match', 'graph']) }),
);

export const KnowledgeGraphNavigated = defineEvent(
  'knowledge_graph_navigated',
  1,
  props({ from_term_id: canonicalId(), to_term_id: canonicalId(), relation: z.enum(RELATION_IDS) }),
);

// --- Client-local playtest events -------------------------------------------------------------------------------

export const AppBackgrounded = defineEvent(
  'app_backgrounded',
  1,
  props({ foreground_ms: intAtLeast(0) }),
);

export const BotMatchStarted = defineEvent(
  'bot_match_started',
  1,
  props({
    local_match_id: uuid(),
    mode: z.literal('classic'),
    format: z.literal('untimed-vs-bot'),
    bot_personality: z.enum(BOT_PERSONALITIES),
    first_player: z.enum(['player', 'bot']),
    lexicon_version: hex16(),
    engine_rules_version: intAtLeast(1),
    bot_version: intAtLeast(1),
    is_first_match: bool(),
  }),
);

export const BotMatchFinished = defineEvent(
  'bot_match_finished',
  1,
  props({
    local_match_id: uuid(),
    bot_personality: z.enum(BOT_PERSONALITIES),
    bot_version: intAtLeast(1),
    engine_rules_version: intAtLeast(1),
    result: z.enum(['win', 'loss', 'draw']),
    end_reason: z.enum(['out', 'scoreless_turns', 'resign']),
    player_score: int(),
    bot_score: int(),
    score_margin: int(),
    bag_count_at_end: intBetween(0, 100),
    tiles_on_board_at_end: intBetween(0, 100),
    forced_pass_tail: intAtLeast(0),
    active_duration_ms: intAtLeast(0),
    turns: intAtLeast(0),
    words_played: intAtLeast(0),
    rejected_attempts: intAtLeast(0),
    exchanges: intAtLeast(0),
    passes: intAtLeast(0),
    resume_count: intAtLeast(0),
  }).check(
    z.refine(
      (p) => p.score_margin === p.player_score - p.bot_score,
      'score_margin = player_score − bot_score',
    ),
    z.refine(
      (p) => p.end_reason === 'scoreless_turns' || p.forced_pass_tail === 0,
      'forced_pass_tail is 0 unless end_reason = scoreless_turns',
    ),
  ),
);

export const BotMatchAbandoned = defineEvent(
  'bot_match_abandoned',
  1,
  props({
    local_match_id: uuid(),
    reason: z.enum(['replaced_by_new', 'version_mismatch', 'state_corrupt']),
    turns: intAtLeast(0),
    active_duration_ms: intAtLeast(0),
  }),
);

export const BotMatchResumed = defineEvent(
  'bot_match_resumed',
  1,
  props({
    local_match_id: uuid(),
    resume_source: z.enum(['background', 'cold_start']),
    away_ms: intAtLeast(0),
    restore_ms: intAtLeast(0),
  }),
);

export const BotDecisionMade = defineEvent(
  'bot_decision_made',
  1,
  props({
    local_match_id: uuid(),
    action_index: intAtLeast(0),
    bot_personality: z.enum(BOT_PERSONALITIES),
    bot_version: intAtLeast(1),
    engine_rules_version: intAtLeast(1),
    compute_ms_bucket: z.enum(COMPUTE_MS_BUCKETS),
    total_ms_bucket: z.enum(COMPUTE_MS_BUCKETS),
    budget_exhausted: bool(),
    nodes_used_bucket: z.enum(NODES_USED_BUCKETS),
    automaton: z.enum(['gaddag', 'dawg']),
    action_kind: z.enum(['place_word', 'exchange', 'pass']),
    fallback: bool(),
    recomputed: bool(),
  }),
);

export const BotWordPlayed = defineEvent(
  'bot_word_played',
  1,
  props({
    local_match_id: uuid(),
    actor: z.enum(['player', 'bot']),
    term_id: canonicalId(),
    form_kind: z.enum(['canonical', 'plural', 'verb_s', 'verb_ed', 'verb_ing']),
    category: z.enum(CATEGORY_IDS),
    difficulty: z.enum(DIFFICULTY_IDS),
    points: intAtLeast(0),
    /** `tech_square` is reserved: never set while tech squares are off (catalogue). */
    bonus_flags: setOf(['term', 'full_stack', 'chain', 'tech_square']),
    think_ms: intAtLeast(0),
    turn: intAtLeast(0),
  }),
);

export const WordRejected = defineEvent(
  'word_rejected',
  1,
  props({
    local_match_id: uuid(),
    reason: z.enum(['not_in_lexicon', 'placement', 'cross_word']),
    word_length: intBetween(0, 15),
    think_ms: intAtLeast(0),
    turn: intAtLeast(0),
  }),
);

export const MatchSummaryAction = defineEvent(
  'match_summary_action',
  1,
  props({
    local_match_id: uuid(),
    action: z.enum(['play_again', 'change_opponent', 'home', 'discover']),
    ms_on_summary: intAtLeast(0),
  }),
);

export const KnowledgeCardClosed = defineEvent(
  'knowledge_card_closed',
  1,
  props({
    term_id: canonicalId(),
    source: z.enum(['post_match', 'graph']),
    dwell_ms: intAtLeast(0),
    related_taps: intAtLeast(0),
  }),
);

export const PlaytestSurveyAnswered = defineEvent(
  'playtest_survey_answered',
  1,
  props({
    survey_id: stringId(),
    question_id: z.literal('would_play_again'),
    answer: z.enum(['yes', 'maybe', 'no', 'dismissed']),
    matches_completed: intAtLeast(0),
  }),
);

export const AnalyticsBufferFlushed = defineEvent(
  'analytics_buffer_flushed',
  1,
  props({
    events_sent: intAtLeast(0),
    events_dropped_since_last: intAtLeast(0),
    oldest_event_age_ms: intAtLeast(0),
  }),
);

// --- Registry ---------------------------------------------------------------------------------------------------

/** Every event of the E-1.5 playtest build, by name (frozen against the catalogue). */
export const EVENT_SCHEMAS = {
  app_opened: AppOpened,
  onboarding_step_completed: OnboardingStepCompleted,
  knowledge_card_opened: KnowledgeCardOpened,
  knowledge_graph_navigated: KnowledgeGraphNavigated,
  app_backgrounded: AppBackgrounded,
  bot_match_started: BotMatchStarted,
  bot_match_finished: BotMatchFinished,
  bot_match_abandoned: BotMatchAbandoned,
  bot_match_resumed: BotMatchResumed,
  bot_decision_made: BotDecisionMade,
  bot_word_played: BotWordPlayed,
  word_rejected: WordRejected,
  match_summary_action: MatchSummaryAction,
  knowledge_card_closed: KnowledgeCardClosed,
  playtest_survey_answered: PlaytestSurveyAnswered,
  analytics_buffer_flushed: AnalyticsBufferFlushed,
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[];

/** Any E-1.5 event in its wire form (queue and export). */
export const AnalyticsEventSchema = z.discriminatedUnion('event', [
  AppOpened.schema,
  OnboardingStepCompleted.schema,
  KnowledgeCardOpened.schema,
  KnowledgeGraphNavigated.schema,
  AppBackgrounded.schema,
  BotMatchStarted.schema,
  BotMatchFinished.schema,
  BotMatchAbandoned.schema,
  BotMatchResumed.schema,
  BotDecisionMade.schema,
  BotWordPlayed.schema,
  WordRejected.schema,
  MatchSummaryAction.schema,
  KnowledgeCardClosed.schema,
  PlaytestSurveyAnswered.schema,
  AnalyticsBufferFlushed.schema,
]);

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;
export type EventOf<N extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[N]['schema']>;
export type EventProperties<N extends EventName> = EventOf<N>['properties'];
/** Envelope fields the recorder fills in (S6a); emitters pass only the name and the properties. */
export type EventEnvelope = Omit<AnalyticsEvent, 'event' | 'schema_version' | 'properties'>;

export type ParsedEvent =
  | { readonly ok: true; readonly event: AnalyticsEvent }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Validates one event at the trust boundary (recorder input, queue read, analyst import). Issues name paths and
 * codes only, never the offending value, so they are safe to count or log.
 */
export function parseAnalyticsEvent(input: unknown): ParsedEvent {
  const result = AnalyticsEventSchema.safeParse(input);
  if (result.success) return { ok: true, event: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (i) => `${i.path.map(String).join('.') || '<root>'}: ${i.code}`,
    ),
  };
}
