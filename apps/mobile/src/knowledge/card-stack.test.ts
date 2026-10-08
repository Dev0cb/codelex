import { describe, expect, it } from '@jest/globals';

import { parseAnalyticsEvent } from '../analytics/events';
import type { AnalyticsCall } from '../analytics/emitter';
import {
  EMPTY_STACK,
  closeCards,
  openCard,
  pauseCards,
  popCard,
  pushRelated,
  resumeCards,
  type CardStack,
} from './card-stack';

const KUBE = { termId: 'kubernetes', form: 'KUBERNETES', playedAs: null };
const DOCKER = { termId: 'docker', form: 'DOCKER', playedAs: null };
const POD = { termId: 'pod', form: 'POD', playedAs: null };

/** Every call must pass the D1 schema once S6a fills the envelope. */
function expectValid(calls: readonly AnalyticsCall[]): void {
  for (const call of calls) {
    const parsed = parseAnalyticsEvent({
      event: call.event,
      schema_version: 1,
      event_id: '00000000-0000-4000-8000-000000000001',
      occurred_at: '2026-10-08T10:00:00.000Z',
      user_id: '3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f',
      session_id: '7d9e2f10-4a3b-4c5d-9e8f-0a1b2c3d4e5f',
      app_version: '0.1.0',
      platform: 'android',
      locale: 'fr',
      properties: call.properties,
    });
    expect(parsed.ok).toBe(true);
  }
}

describe('card stack (design §5.7 navigation and events)', () => {
  it('opens from the Summary, hops to related terms, goes back and closes', () => {
    let step = openCard(EMPTY_STACK, KUBE, 1000);
    expect(step.stack.map((e) => e.termId)).toEqual(['kubernetes']);
    expect(step.calls).toEqual([
      {
        event: 'knowledge_card_opened',
        properties: { term_id: 'kubernetes', source: 'post_match' },
      },
    ]);

    step = pushRelated(step.stack, DOCKER, 'related_to', 4000);
    expect(step.stack.map((e) => e.termId)).toEqual(['kubernetes', 'docker']);
    expect(step.calls).toEqual([
      {
        event: 'knowledge_graph_navigated',
        properties: { from_term_id: 'kubernetes', to_term_id: 'docker', relation: 'related_to' },
      },
      { event: 'knowledge_card_opened', properties: { term_id: 'docker', source: 'graph' } },
    ]);
    expectValid(step.calls);

    step = popCard(step.stack, 6500);
    expect(step.stack.map((e) => e.termId)).toEqual(['kubernetes']);
    expect(step.calls).toEqual([
      {
        event: 'knowledge_card_closed',
        properties: { term_id: 'docker', source: 'graph', dwell_ms: 2500, related_taps: 0 },
      },
    ]);

    // Kubernetes was on screen 1000→4000 and again from 6500.
    step = closeCards(step.stack, 7000);
    expect(step.stack).toEqual([]);
    expect(step.calls).toEqual([
      {
        event: 'knowledge_card_closed',
        properties: {
          term_id: 'kubernetes',
          source: 'post_match',
          dwell_ms: 3500,
          related_taps: 1,
        },
      },
    ]);
    expectValid(step.calls);
  });

  it('closes every open card, top first, when the sheet closes', () => {
    let stack: CardStack = openCard(EMPTY_STACK, KUBE, 0).stack;
    stack = pushRelated(stack, DOCKER, 'related_to', 100).stack;
    stack = pushRelated(stack, POD, 'part_of', 300).stack;
    const step = closeCards(stack, 1000);
    expect(step.calls.map((c) => [c.event, c.properties])).toEqual([
      [
        'knowledge_card_closed',
        { term_id: 'pod', source: 'graph', dwell_ms: 700, related_taps: 0 },
      ],
      [
        'knowledge_card_closed',
        { term_id: 'docker', source: 'graph', dwell_ms: 200, related_taps: 1 },
      ],
      [
        'knowledge_card_closed',
        { term_id: 'kubernetes', source: 'post_match', dwell_ms: 100, related_taps: 1 },
      ],
    ]);
  });

  it('pops the last card like a close, and ignores pops and closes with nothing open', () => {
    const open = openCard(EMPTY_STACK, KUBE, 0).stack;
    expect(popCard(open, 50).stack).toEqual([]);
    expect(popCard(EMPTY_STACK, 0)).toEqual({ stack: [], calls: [] });
    expect(closeCards(EMPTY_STACK, 0)).toEqual({ stack: [], calls: [] });
    expect(pushRelated(EMPTY_STACK, DOCKER, 'uses', 0)).toEqual({ stack: [], calls: [] });
  });

  it('opening from the Summary while a card is open closes the old stack first', () => {
    const open = openCard(EMPTY_STACK, KUBE, 0).stack;
    const step = openCard(open, DOCKER, 10);
    expect(step.stack.map((e) => e.termId)).toEqual(['docker']);
    expect(step.calls.map((c) => c.event)).toEqual([
      'knowledge_card_closed',
      'knowledge_card_opened',
    ]);
  });

  it('does not count time in the background as dwell, and never goes negative', () => {
    let stack = openCard(EMPTY_STACK, KUBE, 0).stack;
    stack = pauseCards(stack, 1000);
    stack = pauseCards(stack, 1500);
    stack = resumeCards(stack, 60_000);
    stack = resumeCards(stack, 60_500);
    expect(closeCards(stack, 61_000).calls[0]?.properties).toMatchObject({ dwell_ms: 2000 });
    // A clock going backwards (device time change) clamps at 0.
    const back = openCard(EMPTY_STACK, KUBE, 5000).stack;
    expect(closeCards(back, 4000).calls[0]?.properties).toMatchObject({ dwell_ms: 0 });
    expect(pauseCards(EMPTY_STACK, 0)).toEqual([]);
  });

  it('keeps the played form of the first card only', () => {
    const stack = openCard(EMPTY_STACK, { ...POD, playedAs: 'PODS' }, 0).stack;
    expect(stack[0]?.playedAs).toBe('PODS');
  });
});
