/**
 * The pure parts of the gameplay analytics (sprint 4 EV): catalogue buckets, the rejection reason, the stored
 * open-match record and `bot_match_finished.forced_pass_tail`. The flows are tested through the screens in
 * `features/match/match-events.test.tsx`.
 */
import type { Action, MatchState, Rejection } from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { AnalyticsCall } from '../analytics/emitter';
import { guardEvent } from '../analytics/event-guard';
import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { startModel, type MatchModel } from './match-model';
import {
  finishedProperties,
  MatchTelemetry,
  MAX_REJECTED_EVENTS_PER_MATCH,
  MAX_REJECTED_EVENTS_PER_TURN,
  msBucket,
  nodesBucket,
  parsePlayRecord,
  rejectedReason,
} from './match-telemetry';
import { humanStarts, loadBundledLexicon, newPlayState } from './test-support';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

describe('buckets (catalogue "Latency and node buckets")', () => {
  it('puts each edge in the upper bucket', () => {
    expect([0, 249, 250, 999, 1000, 1999, 2000, 3999, 4000, 60_000].map(msBucket)).toEqual([
      'lt_250',
      'lt_250',
      '250_500',
      '500_1000',
      '1000_1500',
      '1500_2000',
      '2000_3000',
      '3000_4000',
      'ge_4000',
      'ge_4000',
    ]);
    expect(
      [0, 999, 1000, 9999, 10_000, 70_000, 100_000, 199_999, 200_000].map(nodesBucket),
    ).toEqual([
      'lt_1k',
      'lt_1k',
      '1k_10k',
      '1k_10k',
      '10k_50k',
      '50k_100k',
      '100k_200k',
      '100k_200k',
      'ge_200k',
    ]);
  });
});

describe('rejectedReason', () => {
  const base = { kind: 'rejection', message: '' } as const;
  it('aggregates the engine codes to the three catalogue values', () => {
    const notInLexicon = (main: boolean) =>
      ({
        ...base,
        code: 'not_in_lexicon',
        details: { words: [{ form: 'QX', main }] },
      }) as Rejection;
    expect(rejectedReason(notInLexicon(true))).toBe('not_in_lexicon');
    expect(rejectedReason(notInLexicon(false))).toBe('cross_word');
    expect(rejectedReason({ ...base, code: 'placement', details: { violation: 'gap' } })).toBe(
      'placement',
    );
    expect(rejectedReason(null)).toBe('placement');
  });
});

describe('parsePlayRecord', () => {
  const open = {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'abc',
    activeMs: 1,
    rejected: 2,
    resumes: 3,
    turns: 4,
    lastWall: 5,
    rejectedEvents: 1,
    closed: false,
  };
  it('reads a stored record and treats anything else as a fresh one', () => {
    expect(parsePlayRecord(JSON.stringify({ v: 1, open }))).toEqual({ open });
    expect(parsePlayRecord(JSON.stringify({ v: 1, open: { ...open, turns: -1 } }))).toEqual({
      open: null,
    });
    for (const text of [null, '', '{', 'null', '{"v":2,"open":null}', '[1]']) {
      expect(parsePlayRecord(text)).toEqual({ open: null });
    }
  });
});

describe('finishedProperties', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  function finished(reason: 'scoreless_turns' | 'resign', bag: string, actions: Action['type'][]) {
    const state = newPlayState(humanStarts(lexicon, 1501), lexicon);
    const model = startModel(state);
    const ended: MatchState = {
      ...state,
      status: 'finished',
      bag: bag,
      result: {
        end: { reason, seat: 0 },
        adjustments: [0, 0],
        teamScores: [0, 0],
        places: [1, 1],
        decidedBy: 'score',
      },
    };
    return {
      ...model,
      state: ended,
      actions: actions.map((type) => ({ seat: 0, type }) as Action),
    };
  }
  const counters = { id, activeMs: 10, rejected: 1, resumes: 0 };

  it('counts the trailing passes taken with fewer than 7 tiles in the bag, only on a scoreless end', () => {
    const tail = finished('scoreless_turns', 'AB', [
      'PLACE_WORD',
      'PASS',
      'EXCHANGE',
      'PASS',
      'PASS',
    ]);
    const props = finishedProperties(tail, counters);
    expect(props).toMatchObject({
      result: 'draw',
      end_reason: 'scoreless_turns',
      bag_count_at_end: 2,
      forced_pass_tail: 2,
      words_played: 1,
      exchanges: 1,
      passes: 3,
      rejected_attempts: 1,
    });
    expect(
      finishedProperties(finished('scoreless_turns', 'ABCDEFGH', ['PASS', 'PASS']), counters)
        ?.forced_pass_tail,
    ).toBe(0);
    expect(finishedProperties(finished('resign', '', ['PASS']), counters)?.forced_pass_tail).toBe(
      0,
    );
  });

  it('returns null for a match that is not finished', () => {
    const state = newPlayState(humanStarts(lexicon, 1502), lexicon);
    expect(finishedProperties(startModel(state), counters)).toBeNull();
  });

  it('builds an event the guard accepts', () => {
    const props = finishedProperties(finished('scoreless_turns', 'AB', ['PASS']), counters);
    const event = {
      event: 'bot_match_finished',
      schema_version: 1,
      event_id: '00000000-0000-4000-8000-000000000002',
      occurred_at: '2026-10-16T09:00:00.000Z',
      user_id: '00000000-0000-4000-8000-000000000003',
      session_id: '00000000-0000-4000-8000-000000000004',
      app_version: '0.1.0',
      platform: 'android',
      locale: 'en-US',
      properties: props,
    };
    expect(guardEvent(event).ok).toBe(true);
  });
});

describe('MatchTelemetry (host-level rules)', () => {
  function host() {
    let file: string | null = null;
    let ids = 0;
    const fake = {
      generation: 0,
      events: [] as AnalyticsCall[],
      writes: 0,
      removes: 0,
      file: (): string | null => file,
      isRecording: () => true,
      emit: (call: AnalyticsCall) => {
        fake.events.push(call);
      },
      monoNow: () => 0,
      wallNow: () => 0,
      newId: () => {
        ids += 1;
        return `id-${String(ids)}`;
      },
      readPlayRecord: () => file,
      writePlayRecord: (text: string) => {
        fake.writes += 1;
        file = text;
      },
      removePlayRecord: () => {
        fake.removes += 1;
        file = null;
      },
      onboardingStep: () => undefined,
      consentGeneration: () => fake.generation,
    };
    return fake;
  }
  const rejectedModel = (model: MatchModel): MatchModel => ({
    ...model,
    rejection: { key: 'match.reject.generic', params: {} },
    rejectionCause: null,
  });

  it('caps word_rejected per turn and per match, counts every attempt, and writes only when it emits', () => {
    const fake = host();
    const telemetry = new MatchTelemetry(fake, lexicon.index);
    const model = startModel(newPlayState(humanStarts(lexicon, 1503), lexicon));
    telemetry.started(model, () => false);
    expect(fake.writes).toBe(1);
    const perTurn = MAX_REJECTED_EVENTS_PER_TURN + 2;
    const turns = Math.ceil(MAX_REJECTED_EVENTS_PER_MATCH / MAX_REJECTED_EVENTS_PER_TURN) + 1;
    for (let turn = 0; turn < turns; turn += 1) {
      // A new player turn (the per-turn cap restarts).
      telemetry.resumedSaved(model);
      for (let i = 0; i < perTurn; i += 1) {
        telemetry.transition(model, rejectedModel(model), { type: 'play' }, 0);
      }
    }
    const rejected = fake.events.filter((e) => e.event === 'word_rejected');
    expect(rejected).toHaveLength(MAX_REJECTED_EVENTS_PER_MATCH);
    expect(fake.writes).toBe(1 + MAX_REJECTED_EVENTS_PER_MATCH);
    // The capped attempts reach the file with the next write (here: the background).
    telemetry.appState('background', model);
    expect(fake.writes).toBe(2 + MAX_REJECTED_EVENTS_PER_MATCH);
    expect(parsePlayRecord(fake.file()).open).toMatchObject({
      rejected: turns * perTurn,
      rejectedEvents: MAX_REJECTED_EVENTS_PER_MATCH,
    });
  });

  it('forgets the open match, its clocks and the last Summary when the consent generation changes', () => {
    const fake = host();
    const telemetry = new MatchTelemetry(fake, lexicon.index);
    const model = startModel(newPlayState(humanStarts(lexicon, 1504), lexicon));
    telemetry.started(model, () => false);
    telemetry.transition(model, rejectedModel(model), { type: 'play' }, 0);
    const before = parsePlayRecord(fake.file()).open?.id;
    // Consent off then on: the recorder purged the file and moved to a new generation.
    fake.generation += 1;
    fake.removePlayRecord();
    telemetry.sync();
    telemetry.transition(model, rejectedModel(model), { type: 'play' }, 0);
    const after = parsePlayRecord(fake.file()).open;
    expect(after?.id).not.toBe(before);
    expect(after).toMatchObject({ rejected: 1, rejectedEvents: 1 });
  });
});
