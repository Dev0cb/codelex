/**
 * The on-device guard must accept exactly what the D1 zod schemas accept (catalogue "Schema contract"): compared on
 * every catalogue sample and on generated mutations of each (wrong types, bounds, enum values, missing, extra and
 * undefined keys, refinement breaks). zod runs here, in Jest only; the app bundle never imports it.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  BOT_PERSONALITIES,
  CANONICAL_ID_PATTERN,
  APP_VERSION_PATTERN,
  CATEGORY_IDS,
  COMPUTE_MS_BUCKETS,
  DIFFICULTY_IDS,
  EVENT_NAMES,
  EVENT_SCHEMAS,
  LOCALE_PATTERN,
  NODES_USED_BUCKETS,
  parseAnalyticsEvent,
  PLATFORMS,
  RELATION_IDS,
  STRING_ID_PATTERN,
} from './events';
import {
  eventVersion,
  GUARD_APP_VERSION,
  GUARD_BOT_PERSONALITIES,
  GUARD_CANONICAL_ID,
  GUARD_CATEGORY_IDS,
  GUARD_COMPUTE_MS_BUCKETS,
  GUARD_DIFFICULTY_IDS,
  GUARD_LOCALE,
  GUARD_NODES_USED_BUCKETS,
  GUARD_PLATFORMS,
  GUARD_RELATION_IDS,
  GUARD_STRING_ID,
  guardEvent,
} from './event-guard';
import { sampleEvent } from './test-support';

/** Values a mutation may put anywhere: every type, edges of every bound, and every enum value in use. */
const POOL: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -1,
  1,
  1.5,
  15,
  16,
  100,
  101,
  Number.MAX_SAFE_INTEGER + 1,
  Number.NaN,
  '',
  'x',
  'a'.repeat(65),
  'api',
  'Api',
  'api-',
  'zh-Hant-TW',
  'fr-SN',
  'en-US-u-fw-mon',
  '0.1.0',
  '1.2',
  '2026-10-07T09:30:00.000Z',
  '2026-10-07T09:30:00+01:00',
  '2026-02-30T09:30:00Z',
  '3F0C8A4E-9B1D-4C2A-8E6F-1A2B3C4D5E6F',
  '3f0c8a4e-9b1d-1c2a-8e6f-1a2b3c4d5e6f',
  '0123456789abcdef',
  '0123456789ABCDEF',
  'would_play_again',
  'stage0',
  '_stage',
  [],
  ['term'],
  ['term', 'term'],
  ['term', 'full_stack', 'chain', 'tech_square'],
  ['nope'],
  {},
  ...PLATFORMS,
  ...CATEGORY_IDS,
  ...DIFFICULTY_IDS,
  ...RELATION_IDS,
  ...BOT_PERSONALITIES,
  ...COMPUTE_MS_BUCKETS,
  ...NODES_USED_BUCKETS,
  'classic',
  'untimed-vs-bot',
  'player',
  'bot',
  'win',
  'loss',
  'draw',
  'out',
  'scoreless_turns',
  'resign',
  'in_memory',
  'snapshot',
  'background',
  'cold_start',
  'none',
  'unknown',
  'post_match',
  'graph',
  'yes',
  'dismissed',
];

type Mutation =
  | { readonly kind: 'set'; readonly top: boolean; readonly key: number; readonly value: number }
  | { readonly kind: 'delete'; readonly top: boolean; readonly key: number }
  | { readonly kind: 'extra'; readonly top: boolean };

const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant('set' as const),
    top: fc.boolean(),
    key: fc.nat(),
    value: fc.nat(POOL.length - 1),
  }),
  fc.record({ kind: fc.constant('delete' as const), top: fc.boolean(), key: fc.nat() }),
  fc.record({ kind: fc.constant('extra' as const), top: fc.boolean() }),
);

function mutate(
  event: Record<string, unknown>,
  mutations: readonly Mutation[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...event,
    properties: { ...(event['properties'] as Record<string, unknown>) },
  };
  for (const m of mutations) {
    const target =
      m.top || typeof out['properties'] !== 'object' || out['properties'] === null
        ? out
        : (out['properties'] as Record<string, unknown>);
    const keys = Object.keys(target);
    if (m.kind === 'extra') {
      target['extra'] = 1;
    } else if (keys.length > 0) {
      const key = keys[m.key % keys.length] ?? '';
      if (m.kind === 'delete') Reflect.deleteProperty(target, key);
      else target[key] = POOL[m.value];
    }
  }
  return out;
}

describe('guardEvent ≡ D1 zod schemas', () => {
  it('mirrors the shared constants and patterns of events.ts', () => {
    expect(GUARD_PLATFORMS).toEqual(PLATFORMS);
    expect(GUARD_CATEGORY_IDS).toEqual(CATEGORY_IDS);
    expect(GUARD_DIFFICULTY_IDS).toEqual(DIFFICULTY_IDS);
    expect(GUARD_RELATION_IDS).toEqual(RELATION_IDS);
    expect(GUARD_BOT_PERSONALITIES).toEqual(BOT_PERSONALITIES);
    expect(GUARD_COMPUTE_MS_BUCKETS).toEqual(COMPUTE_MS_BUCKETS);
    expect(GUARD_NODES_USED_BUCKETS).toEqual(NODES_USED_BUCKETS);
    expect(GUARD_CANONICAL_ID.source).toBe(CANONICAL_ID_PATTERN.source);
    expect(GUARD_STRING_ID.source).toBe(STRING_ID_PATTERN.source);
    expect(GUARD_APP_VERSION.source).toBe(APP_VERSION_PATTERN.source);
    expect(GUARD_LOCALE.source).toBe(LOCALE_PATTERN.source);
    for (const name of EVENT_NAMES) expect(eventVersion(name)).toBe(EVENT_SCHEMAS[name].version);
  });

  it('accepts every catalogue sample', () => {
    for (const name of EVENT_NAMES) expect(guardEvent(sampleEvent(name)).ok).toBe(true);
  });

  it('rejects what is not an event at all', () => {
    for (const input of [null, 1, 'x', [], {}, { event: 'nope' }, { event: 'toString' }]) {
      expect(guardEvent(input).ok).toBe(false);
      expect(parseAnalyticsEvent(input).ok).toBe(false);
    }
  });

  it('agrees with zod on generated mutations of every event (property)', () => {
    for (const name of EVENT_NAMES) {
      const base = sampleEvent(name);
      fc.assert(
        fc.property(fc.array(mutation, { minLength: 1, maxLength: 3 }), (mutations) => {
          const input = mutate(base, mutations);
          expect(guardEvent(input).ok).toBe(parseAnalyticsEvent(input).ok);
        }),
        { numRuns: 400 },
      );
    }
  });

  it('agrees with zod on the cross-field rules', () => {
    const finished = sampleEvent('bot_match_finished');
    const props = finished['properties'] as Record<string, unknown>;
    const cases = [
      { ...props, score_margin: 7 },
      { ...props, end_reason: 'out', forced_pass_tail: 4 },
      { ...props, end_reason: 'out', forced_pass_tail: 0 },
    ];
    for (const p of cases) {
      const input = { ...finished, properties: p };
      expect(guardEvent(input).ok).toBe(parseAnalyticsEvent(input).ok);
    }
    const opened = sampleEvent('app_opened');
    for (const p of [
      { network_type: 'none' },
      { network_type: 'none', cold_start_ms: 5 },
      { network_type: 'none', previous_exit_unclean: true },
      { network_type: 'none', cold_start_ms: undefined, previous_exit_unclean: undefined },
    ]) {
      const input = { ...opened, properties: p };
      expect(guardEvent(input).ok).toBe(parseAnalyticsEvent(input).ok);
    }
    const resumed = sampleEvent('bot_match_resumed');
    for (const [source, path] of [
      ['background', 'in_memory'],
      ['background', 'snapshot'],
      ['cold_start', 'in_memory'],
    ]) {
      const input = {
        ...resumed,
        properties: {
          ...(resumed['properties'] as Record<string, unknown>),
          resume_source: source,
          restore_path: path,
        },
      };
      expect(guardEvent(input).ok).toBe(parseAnalyticsEvent(input).ok);
    }
  });
});
