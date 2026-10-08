/**
 * Navigation of the Knowledge Card sheet (design §5.7) as a pure stack, with the analytics calls each step produces
 * (catalogue: `knowledge_card_opened`, `knowledge_graph_navigated`, `knowledge_card_closed`). The sheet hook emits the
 * calls; the clock is passed in (ms, monotonic enough: a backwards jump clamps dwell at 0).
 *
 * Semantics (ASSUMPTION, written for `data-analyst`): one `knowledge_card_closed` per `knowledge_card_opened`, sent
 * when that card leaves the stack (Back pops it; Close, swipe, scrim or system back on the first card closes every
 * card, top first). `dwell_ms` counts only the time the card was the visible top card with the app in the
 * foreground; `related_taps` counts the hops made from that card.
 */
import type { RelationType } from '@codelex/lexicon/index';

import type { AnalyticsCall } from '../analytics/emitter';

export type CardSource = 'post_match' | 'graph';

export interface CardTarget {
  readonly termId: string;
  /** Canonical form. */
  readonly form: string;
  /** Form as played, when the card was opened from a played word. */
  readonly playedAs: string | null;
}

export interface StackEntry extends CardTarget {
  readonly source: CardSource;
  /** Dwell accumulated while this card was on top before `since`. */
  readonly dwellMs: number;
  /** When this card last became the visible top card; null while covered or paused. */
  readonly since: number | null;
  readonly relatedTaps: number;
}

export type CardStack = readonly StackEntry[];

export interface StackStep {
  readonly stack: CardStack;
  readonly calls: readonly AnalyticsCall[];
}

export const EMPTY_STACK: CardStack = [];

const elapsed = (entry: StackEntry, now: number): number =>
  entry.since === null ? 0 : Math.max(0, now - entry.since);

const pause = (entry: StackEntry, now: number): StackEntry =>
  entry.since === null
    ? entry
    : { ...entry, dwellMs: entry.dwellMs + elapsed(entry, now), since: null };

const closed = (entry: StackEntry, now: number): AnalyticsCall => ({
  event: 'knowledge_card_closed',
  properties: {
    term_id: entry.termId,
    source: entry.source,
    dwell_ms: Math.round(entry.dwellMs + elapsed(entry, now)),
    related_taps: entry.relatedTaps,
  },
});

const entryOf = (target: CardTarget, source: CardSource, now: number): StackEntry => ({
  ...target,
  source,
  dwellMs: 0,
  since: now,
  relatedTaps: 0,
});

/** Closes every card, top first. */
export function closeCards(stack: CardStack, now: number): StackStep {
  return { stack: EMPTY_STACK, calls: [...stack].reverse().map((entry) => closed(entry, now)) };
}

/** Opens a card from the Summary (term chip, best word or Discover). */
export function openCard(stack: CardStack, target: CardTarget, now: number): StackStep {
  const previous = closeCards(stack, now);
  return {
    stack: [entryOf(target, 'post_match', now)],
    calls: [
      ...previous.calls,
      {
        event: 'knowledge_card_opened',
        properties: { term_id: target.termId, source: 'post_match' },
      },
    ],
  };
}

/** A related-term tap: the current card is covered, the related card opens on top. */
export function pushRelated(
  stack: CardStack,
  target: CardTarget,
  relation: RelationType,
  now: number,
): StackStep {
  const top = stack.at(-1);
  if (top === undefined) return { stack, calls: [] };
  const covered: StackEntry = { ...pause(top, now), relatedTaps: top.relatedTaps + 1 };
  return {
    stack: [...stack.slice(0, -1), covered, entryOf(target, 'graph', now)],
    calls: [
      {
        event: 'knowledge_graph_navigated',
        properties: { from_term_id: top.termId, to_term_id: target.termId, relation },
      },
      { event: 'knowledge_card_opened', properties: { term_id: target.termId, source: 'graph' } },
    ],
  };
}

/** Back: closes the top card and shows the previous one (or closes the sheet from the first card). */
export function popCard(stack: CardStack, now: number): StackStep {
  const top = stack.at(-1);
  if (top === undefined) return { stack, calls: [] };
  const rest = stack.slice(0, -1);
  const below = rest.at(-1);
  return {
    stack: below === undefined ? EMPTY_STACK : [...rest.slice(0, -1), { ...below, since: now }],
    calls: [closed(top, now)],
  };
}

/** The app went to the background: stop the visible card's dwell clock. */
export function pauseCards(stack: CardStack, now: number): CardStack {
  const top = stack.at(-1);
  return top === undefined ? stack : [...stack.slice(0, -1), pause(top, now)];
}

/** Back in the foreground: restart the visible card's dwell clock. */
export function resumeCards(stack: CardStack, now: number): CardStack {
  const top = stack.at(-1);
  if (top === undefined || top.since !== null) return stack;
  return [...stack.slice(0, -1), { ...top, since: now }];
}
