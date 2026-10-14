import type { RelationType } from '@codelex/lexicon/index';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAnalytics, type AnalyticsCall, type AnalyticsEmitter } from '../../analytics/emitter';
import { knowledgeCard, type CardDeps, type KnowledgeCard } from '../../knowledge/card-model';
import {
  EMPTY_STACK,
  closeCards,
  openCard,
  pauseCards,
  popCard,
  pushRelated,
  resumeCards,
  type CardStack,
  type CardTarget,
  type StackStep,
} from '../../knowledge/card-stack';

function emitAll(analytics: AnalyticsEmitter, calls: readonly AnalyticsCall[]): void {
  for (const call of calls) analytics.emit(call);
}

export interface CardSheet {
  /** The visible card; null when the sheet is closed. */
  readonly card: KnowledgeCard | null;
  /** Number of open cards (Back shows from 2). */
  readonly depth: number;
  /** Opens a card from the Summary; false (nothing opens) if the term has no card. */
  readonly open: (target: CardTarget) => boolean;
  readonly openRelated: (target: CardTarget, relation: RelationType) => void;
  /** Back arrow and Android back: one card back, or closes from the first card. */
  readonly back: () => void;
  /** Close ×, swipe down, scrim tap. */
  readonly close: () => void;
}

/**
 * State of the Knowledge Card sheet over the Summary (design §5.7): the card stack, its analytics (through the
 * {@link useAnalytics} emitter, a no-op until S6a) and the dwell clock, paused while the app is in the background.
 * A card still open when the Summary unmounts (Play again cannot be pressed under the sheet, but the app can be
 * killed) is closed with its dwell.
 */
export function useCardSheet(deps: CardDeps | null, now: () => number = Date.now): CardSheet {
  const analytics = useAnalytics();
  const [stack, setStack] = useState<CardStack>(EMPTY_STACK);
  const stackRef = useRef(stack);
  // The clock of the first render is kept (tests inject one; the app uses Date.now).
  const [clock] = useState(() => now);

  const show = useCallback((next: CardStack) => {
    stackRef.current = next;
    setStack(next);
  }, []);
  const analyticsRef = useRef(analytics);
  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);
  const apply = useCallback(
    (step: StackStep) => {
      show(step.stack);
      emitAll(analyticsRef.current, step.calls);
    },
    [show],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const at = clock();
      show(
        state === 'active' ? resumeCards(stackRef.current, at) : pauseCards(stackRef.current, at),
      );
    });
    return () => {
      subscription.remove();
      emitAll(analyticsRef.current, closeCards(stackRef.current, clock()).calls);
    };
  }, [clock, show]);

  // Kill switch flipped (or the card text became unusable) while a card is open: close every card now, with its
  // dwell, instead of leaving a hidden stack whose clock keeps running.
  const disabled = deps === null;
  const hasOpenCards = stack.length > 0;
  useEffect(() => {
    if (disabled && hasOpenCards) apply(closeCards(stackRef.current, clock()));
  }, [disabled, hasOpenCards, apply, clock]);

  const top = stack.at(-1);
  const card = useMemo(
    () =>
      top === undefined || deps === null
        ? null
        : knowledgeCard(deps, top.termId, top.form, top.playedAs),
    [deps, top],
  );

  const open = useCallback(
    (target: CardTarget) => {
      if (deps === null || knowledgeCard(deps, target.termId, target.form) === null) return false;
      apply(openCard(stackRef.current, target, clock()));
      return true;
    },
    [apply, clock, deps],
  );
  const openRelated = useCallback(
    (target: CardTarget, relation: RelationType) => {
      apply(pushRelated(stackRef.current, target, relation, clock()));
    },
    [apply, clock],
  );
  const back = useCallback(() => {
    apply(popCard(stackRef.current, clock()));
  }, [apply, clock]);
  const close = useCallback(() => {
    apply(closeCards(stackRef.current, clock()));
  }, [apply, clock]);

  return { card, depth: stack.length, open, openRelated, back, close };
}
