/**
 * On-device validation of analytics events (AC-17, catalogue "Validation"; slice S6a), without zod at runtime.
 *
 * Why not the D1 zod schemas on the device: `zod/mini` resolves to CommonJS that Metro cannot tree-shake, and it
 * measured ≈ +555 KB of Hermes bytecode per platform (S6a, sprint 4), beyond the bundle budget once S5 lands. The zod
 * schemas of `events.ts` stay the source of truth for Node (readout KR, TM-08 import, tests). This guard is a
 * hand-written mirror of them: same event names and versions, same envelope, same property types, bounds, enums,
 * required/optional keys, strict keys at both levels and the same cross-field refinements. `event-guard.test.ts`
 * compares it with the zod schemas on every catalogue sample and on thousands of mutations, so the two cannot drift.
 *
 * Only `import type` from `events.ts`: this module adds no zod code to the bundle (as `emitter.ts`).
 */
import type { AnalyticsEvent, EventName } from './events';

type Check = (value: unknown) => boolean;
interface Optional {
  readonly optional: Check;
}
type Field = Check | Optional;

// --- Mirrors of the shared value schemas of events.ts (equality tested) ----------------------------------------

export const GUARD_CANONICAL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const GUARD_STRING_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const GUARD_APP_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,5}$/;
export const GUARD_LOCALE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;
/** zod 4 `z.uuidv4()`. */
const UUID_V4 =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/;
/** zod 4 `z.iso.datetime()` (UTC `Z` only, seconds required, any fraction). */
const ISO_DATETIME =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z))$/;
const HEX16 = /^[0-9a-f]{16}$/;

export const GUARD_PLATFORMS = ['ios', 'android'] as const;
export const GUARD_CATEGORY_IDS = [
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
export const GUARD_DIFFICULTY_IDS = ['novice', 'intermediate', 'advanced', 'expert'] as const;
export const GUARD_RELATION_IDS = [
  'is_a',
  'part_of',
  'uses',
  'related_to',
  'alternative_to',
  'runs_on',
  'implements',
] as const;
export const GUARD_BOT_PERSONALITIES = ['beginner', 'strategist'] as const;
export const GUARD_COMPUTE_MS_BUCKETS = [
  'lt_250',
  '250_500',
  '500_1000',
  '1000_1500',
  '1500_2000',
  '2000_3000',
  '3000_4000',
  'ge_4000',
] as const;
export const GUARD_NODES_USED_BUCKETS = [
  'lt_1k',
  '1k_10k',
  '10k_50k',
  '50k_100k',
  '100k_200k',
  'ge_200k',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const int =
  (min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): Check =>
  (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const bool: Check = (v) => typeof v === 'boolean';
const matches =
  (pattern: RegExp, maxLength = Number.POSITIVE_INFINITY): Check =>
  (v) =>
    typeof v === 'string' && v.length <= maxLength && pattern.test(v);
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v);
const literal =
  (expected: string | number): Check =>
  (v) =>
    v === expected;
const setOf =
  (values: readonly string[]): Check =>
  (v) =>
    Array.isArray(v) &&
    v.length <= values.length &&
    v.every((x) => oneOf(values)(x)) &&
    new Set(v).size === v.length;
const optional = (check: Check): Optional => ({ optional: check });

const uuid = matches(UUID_V4);
const count = int(0);
const version = int(1);
const canonicalId = matches(GUARD_CANONICAL_ID, 64);
const personality = oneOf(GUARD_BOT_PERSONALITIES);

interface EventSpec {
  readonly version: number;
  readonly properties: Readonly<Record<string, Field>>;
  /** Cross-field rules of the zod schema (`.check(z.refine(…))`). */
  readonly refine?: (p: Readonly<Record<string, unknown>>) => boolean;
}

const SPECS: { readonly [N in EventName]: EventSpec } = {
  app_opened: {
    version: 2,
    properties: {
      cold_start_ms: optional(count),
      network_type: oneOf(['wifi', 'cellular', 'other', 'none', 'unknown']),
      previous_exit_unclean: optional(bool),
    },
    refine: (p) =>
      (p['cold_start_ms'] === undefined) === (p['previous_exit_unclean'] === undefined),
  },
  onboarding_step_completed: {
    version: 1,
    properties: {
      step: oneOf([
        'first_launch',
        'home_seen',
        'play_now_tapped',
        'first_move',
        'coach_mark_1',
        'coach_mark_2',
        'coach_mark_3',
        'first_match_completed',
      ]),
      duration_ms: count,
    },
  },
  knowledge_card_opened: {
    version: 1,
    properties: { term_id: canonicalId, source: oneOf(['post_word', 'post_match', 'graph']) },
  },
  knowledge_graph_navigated: {
    version: 1,
    properties: {
      from_term_id: canonicalId,
      to_term_id: canonicalId,
      relation: oneOf(GUARD_RELATION_IDS),
    },
  },
  app_backgrounded: { version: 1, properties: { foreground_ms: count } },
  bot_match_started: {
    version: 1,
    properties: {
      local_match_id: uuid,
      mode: literal('classic'),
      format: literal('untimed-vs-bot'),
      bot_personality: personality,
      first_player: oneOf(['player', 'bot']),
      lexicon_version: matches(HEX16),
      engine_rules_version: version,
      bot_version: version,
      is_first_match: bool,
    },
  },
  bot_match_finished: {
    version: 1,
    properties: {
      local_match_id: uuid,
      bot_personality: personality,
      bot_version: version,
      engine_rules_version: version,
      result: oneOf(['win', 'loss', 'draw']),
      end_reason: oneOf(['out', 'scoreless_turns', 'resign']),
      player_score: int(),
      bot_score: int(),
      score_margin: int(),
      bag_count_at_end: int(0, 100),
      tiles_on_board_at_end: int(0, 100),
      forced_pass_tail: count,
      active_duration_ms: count,
      turns: count,
      words_played: count,
      rejected_attempts: count,
      exchanges: count,
      passes: count,
      resume_count: count,
    },
    refine: (p) =>
      p['score_margin'] === Number(p['player_score']) - Number(p['bot_score']) &&
      (p['end_reason'] === 'scoreless_turns' || p['forced_pass_tail'] === 0),
  },
  bot_match_abandoned: {
    version: 1,
    properties: {
      local_match_id: uuid,
      reason: oneOf(['replaced_by_new', 'version_mismatch', 'state_corrupt']),
      turns: count,
      active_duration_ms: count,
    },
  },
  bot_match_resumed: {
    version: 1,
    properties: {
      local_match_id: uuid,
      resume_source: oneOf(['background', 'cold_start']),
      away_ms: count,
      restore_ms: count,
      restore_path: oneOf(['in_memory', 'snapshot', 'full_replay', 'failed']),
    },
    refine: (p) => (p['restore_path'] === 'in_memory') === (p['resume_source'] === 'background'),
  },
  bot_decision_made: {
    version: 1,
    properties: {
      local_match_id: uuid,
      action_index: count,
      bot_personality: personality,
      bot_version: version,
      engine_rules_version: version,
      compute_ms_bucket: oneOf(GUARD_COMPUTE_MS_BUCKETS),
      total_ms_bucket: oneOf(GUARD_COMPUTE_MS_BUCKETS),
      budget_exhausted: bool,
      nodes_used_bucket: oneOf(GUARD_NODES_USED_BUCKETS),
      automaton: oneOf(['gaddag', 'dawg']),
      action_kind: oneOf(['place_word', 'exchange', 'pass']),
      fallback: bool,
      recomputed: bool,
    },
  },
  bot_word_played: {
    version: 1,
    properties: {
      local_match_id: uuid,
      actor: oneOf(['player', 'bot']),
      term_id: canonicalId,
      form_kind: oneOf(['canonical', 'plural', 'verb_s', 'verb_ed', 'verb_ing']),
      category: oneOf(GUARD_CATEGORY_IDS),
      difficulty: oneOf(GUARD_DIFFICULTY_IDS),
      points: count,
      bonus_flags: setOf(['term', 'full_stack', 'chain', 'tech_square']),
      think_ms: count,
      turn: count,
    },
  },
  word_rejected: {
    version: 1,
    properties: {
      local_match_id: uuid,
      reason: oneOf(['not_in_lexicon', 'placement', 'cross_word']),
      word_length: int(1, 15),
      think_ms: count,
      turn: count,
    },
  },
  match_summary_action: {
    version: 1,
    properties: {
      local_match_id: uuid,
      action: oneOf(['play_again', 'change_opponent', 'home', 'discover']),
      ms_on_summary: count,
    },
  },
  knowledge_card_closed: {
    version: 1,
    properties: {
      term_id: canonicalId,
      source: oneOf(['post_match', 'graph']),
      dwell_ms: count,
      related_taps: count,
    },
  },
  playtest_survey_shown: {
    version: 1,
    properties: {
      survey_id: matches(GUARD_STRING_ID),
      question_id: literal('would_play_again'),
      matches_completed: count,
    },
  },
  playtest_survey_answered: {
    version: 1,
    properties: {
      survey_id: matches(GUARD_STRING_ID),
      question_id: literal('would_play_again'),
      answer: oneOf(['yes', 'maybe', 'no', 'dismissed']),
      matches_completed: count,
    },
  },
  analytics_buffer_flushed: {
    version: 1,
    properties: {
      events_sent: count,
      events_dropped_since_last: count,
      oldest_event_age_ms: count,
    },
  },
};

/** The `schema_version` of each event (the catalogue `v` column). */
export function eventVersion(name: EventName): number {
  return SPECS[name].version;
}

const ENVELOPE: Readonly<Record<string, Check>> = {
  event_id: uuid,
  occurred_at: matches(ISO_DATETIME),
  user_id: uuid,
  session_id: uuid,
  app_version: matches(GUARD_APP_VERSION),
  platform: oneOf(GUARD_PLATFORMS),
  locale: matches(GUARD_LOCALE, 16),
};
const ENVELOPE_KEYS = new Set(['event', 'schema_version', 'properties', ...Object.keys(ENVELOPE)]);

/** Strict object check: required keys pass, optional keys absent or passing, no unknown key. */
function checkShape(
  value: Record<string, unknown>,
  fields: Readonly<Record<string, Field>>,
): boolean {
  for (const key of Object.keys(value)) if (!Object.hasOwn(fields, key)) return false;
  for (const [key, field] of Object.entries(fields)) {
    const v = value[key];
    if (typeof field === 'function') {
      if (!Object.hasOwn(value, key) || !field(v)) return false;
    } else if (v !== undefined && !field.optional(v)) {
      return false;
    }
  }
  return true;
}

export type GuardedEvent =
  { readonly ok: true; readonly event: AnalyticsEvent } | { readonly ok: false };

/**
 * Validates one wire-form event at the trust boundary (recorder input, queue read). Never throws; never echoes the
 * offending value.
 */
export function guardEvent(input: unknown): GuardedEvent {
  if (!isRecord(input)) return { ok: false };
  const name = input['event'];
  if (typeof name !== 'string' || !Object.hasOwn(SPECS, name)) return { ok: false };
  const spec = SPECS[name as EventName];
  if (input['schema_version'] !== spec.version) return { ok: false };
  for (const key of Object.keys(input)) if (!ENVELOPE_KEYS.has(key)) return { ok: false };
  for (const [key, check] of Object.entries(ENVELOPE)) {
    if (!Object.hasOwn(input, key) || !check(input[key])) return { ok: false };
  }
  const properties = input['properties'];
  if (!isRecord(properties) || !checkShape(properties, spec.properties)) return { ok: false };
  if (spec.refine !== undefined && !spec.refine(properties)) return { ok: false };
  return { ok: true, event: input as unknown as AnalyticsEvent };
}
