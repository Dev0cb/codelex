/**
 * AC-17 event schemas: every E-1.5 event validates strictly (unknown keys and unknown enum values rejected), carries
 * no free text (PII lint over the derived JSON Schema), and reports issues without echoing values.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { toJSONSchema } from 'zod/mini';

import {
  AnalyticsEventSchema,
  EVENT_NAMES,
  EVENT_SCHEMAS,
  parseAnalyticsEvent,
  type EventName,
} from './events.ts';
import { sampleEvent } from './test-support.ts';

interface JsonSchema {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly format?: string;
  readonly pattern?: string;
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
}

/** Paths of string leaves that accept free text (no enum, const, format or pattern). */
function freeTextLeaves(schema: JsonSchema, path: string): string[] {
  const nested = [
    ...Object.entries(schema.properties ?? {}).map(([k, s]) => freeTextLeaves(s, `${path}.${k}`)),
    ...(schema.items ? [freeTextLeaves(schema.items, `${path}[]`)] : []),
    ...[...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].map((s) => freeTextLeaves(s, path)),
  ].flat();
  const constrained =
    schema.enum !== undefined ||
    schema.const !== undefined ||
    schema.format !== undefined ||
    schema.pattern !== undefined;
  return schema.type === 'string' && !constrained ? [path, ...nested] : nested;
}

const NAMES = EVENT_NAMES.map((n) => [n] as const);

describe('E-1.5 analytics events', () => {
  it.each(NAMES)('%s: a valid sample parses', (name) => {
    const parsed = parseAnalyticsEvent(sampleEvent(name));
    expect(parsed).toEqual({ ok: true, event: sampleEvent(name) });
    expect(EVENT_SCHEMAS[name].schema.safeParse(sampleEvent(name)).success).toBe(true);
  });

  it.each(NAMES)('%s: has no free-text string anywhere (PII lint)', (name) => {
    const json = toJSONSchema(EVENT_SCHEMAS[name].schema, { io: 'input' }) as JsonSchema;
    expect(freeTextLeaves(json, name)).toEqual([]);
  });

  it.each(NAMES)('%s: rejects an unknown property and an unknown envelope key', (name) => {
    const extraProp = sampleEvent(name);
    (extraProp['properties'] as Record<string, unknown>)['device_model'] = 'Pixel';
    expect(parseAnalyticsEvent(extraProp).ok).toBe(false);
    const extraEnvelope = { ...sampleEvent(name), uploaded_at: '2026-10-07T10:00:00.000Z' };
    expect(parseAnalyticsEvent(extraEnvelope).ok).toBe(false);
  });

  it.each(NAMES)('%s: rejects a missing required property', (name) => {
    const event = sampleEvent(name);
    const props = event['properties'] as Record<string, unknown>;
    const key = Object.keys(props).find((k) => !(name === 'app_opened' && k !== 'network_type'));
    if (key === undefined) throw new Error('no required key');
    event['properties'] = Object.fromEntries(Object.entries(props).filter(([k]) => k !== key));
    expect(parseAnalyticsEvent(event).ok).toBe(false);
  });

  it('rejects the wrong schema_version, an unknown event and a non-object', () => {
    expect(parseAnalyticsEvent({ ...sampleEvent('app_opened'), schema_version: 1 }).ok).toBe(false);
    expect(parseAnalyticsEvent({ ...sampleEvent('app_opened'), event: 'match_finished' }).ok).toBe(
      false,
    );
    expect(parseAnalyticsEvent('app_opened').ok).toBe(false);
    expect(parseAnalyticsEvent(null)).toEqual({ ok: false, issues: expect.any(Array) as unknown });
  });

  it('validates the envelope fields', () => {
    const bad: Record<string, unknown>[] = [
      { event_id: 'not-a-uuid' },
      { user_id: '3f0c8a4e-9b1d-1c2a-8e6f-1a2b3c4d5e6f' }, // v1, not random
      { occurred_at: '2026-10-07 09:30' },
      { occurred_at: '2026-10-07T11:30:00+02:00' }, // UTC only
      { app_version: '0.1.0 (debug build on Moussa’s phone)' },
      { platform: 'web' },
      { locale: 'fr_FR' },
      { locale: 'Moussa' },
    ];
    for (const patch of bad) {
      expect(parseAnalyticsEvent({ ...sampleEvent('app_backgrounded'), ...patch }).ok).toBe(false);
    }
    for (const locale of ['en', 'fr', 'fr-SN', 'zh-Hant-TW', 'es-419']) {
      expect(parseAnalyticsEvent({ ...sampleEvent('app_backgrounded'), locale }).ok).toBe(true);
    }
  });

  it('app_opened: cold-start properties come together or not at all', () => {
    const warm = sampleEvent('app_opened');
    warm['properties'] = { network_type: 'wifi' };
    expect(parseAnalyticsEvent(warm).ok).toBe(true);
    const half = sampleEvent('app_opened');
    half['properties'] = { network_type: 'wifi', cold_start_ms: 900 };
    expect(parseAnalyticsEvent(half)).toEqual({
      ok: false,
      issues: ['properties: custom'],
    });
    const otherHalf = sampleEvent('app_opened');
    otherHalf['properties'] = { network_type: 'wifi', previous_exit_unclean: true };
    expect(parseAnalyticsEvent(otherHalf).ok).toBe(false);
  });

  it('bot_match_finished: score_margin and forced_pass_tail invariants', () => {
    const wrongMargin = sampleEvent('bot_match_finished');
    (wrongMargin['properties'] as Record<string, unknown>)['score_margin'] = 7;
    expect(parseAnalyticsEvent(wrongMargin).ok).toBe(false);
    const tailWithoutScoreless = sampleEvent('bot_match_finished');
    (tailWithoutScoreless['properties'] as Record<string, unknown>)['end_reason'] = 'out';
    expect(parseAnalyticsEvent(tailWithoutScoreless).ok).toBe(false);
    (tailWithoutScoreless['properties'] as Record<string, unknown>)['forced_pass_tail'] = 0;
    expect(parseAnalyticsEvent(tailWithoutScoreless).ok).toBe(true);
  });

  it('bot_word_played: bonus_flags is a set of known flags', () => {
    const set = (flags: unknown): boolean => {
      const event = sampleEvent('bot_word_played');
      (event['properties'] as Record<string, unknown>)['bonus_flags'] = flags;
      return parseAnalyticsEvent(event).ok;
    };
    expect(set([])).toBe(true);
    expect(set(['term', 'full_stack', 'chain', 'tech_square'])).toBe(true);
    expect(set(['term', 'term'])).toBe(false);
    expect(set(['bingo'])).toBe(false);
  });

  it('never echoes the offending value in issues', () => {
    const event = sampleEvent('word_rejected');
    (event['properties'] as Record<string, unknown>)['reason'] = 'KUBERNETIS';
    (event['properties'] as Record<string, unknown>)['attempt'] = 'KUBERNETIS';
    const parsed = parseAnalyticsEvent(event);
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('KUBERNETIS');
  });

  it('property: any string in place of an enum value is rejected unless it is a listed value', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (value) => {
        const event = sampleEvent('match_summary_action');
        (event['properties'] as Record<string, unknown>)['action'] = value;
        const listed = ['play_again', 'change_opponent', 'home', 'discover'].includes(value);
        expect(parseAnalyticsEvent(event).ok).toBe(listed);
      }),
    );
  });

  it('property: no extra key at any level survives validation', () => {
    const names = fc.constantFrom(...EVENT_NAMES);
    fc.assert(
      fc.property(
        names,
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.boolean(),
        (name: EventName, key, inProperties) => {
          const event = sampleEvent(name);
          const target = inProperties ? (event['properties'] as Record<string, unknown>) : event;
          fc.pre(!(key in target));
          target[key] = 0;
          expect(AnalyticsEventSchema.safeParse(event).success).toBe(false);
        },
      ),
    );
  });
});
