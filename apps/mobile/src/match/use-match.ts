import { useContext, useEffect, useMemo } from 'react';

import { useLexicon } from '../lexicon/lexicon-gate';
import { botRequestFor } from './bot-runner';
import type { MatchCommand, MatchModel } from './match-model';
import { MatchServicesContext } from './match-services';
import { useMatchSession } from './match-session';
import { BOT_SEAT, PLAY_BOT } from './play-config';

export { DEVICE_MATCH_SERVICES, MatchServicesContext, type MatchServices } from './match-services';

export interface UseMatch {
  /** Null when no match is open (`startFailed`: the engine refused the header, `match.start.error`). */
  readonly model: MatchModel | null;
  readonly startFailed: boolean;
  readonly dispatch: (command: MatchCommand) => void;
  /** A new match with a new seed (Play again, Try again). */
  readonly restart: () => void;
}

const noop = (): void => undefined;
const zero = (): number => 0;

/**
 * The match screen's view of the session (`match-session.tsx`). The engine is the only source of outcomes; this
 * hook only sequences the bot: on its turn the request is computed by the runner while the think delay runs, then
 * applied at max(compute, delay) (D-29), unless the match moved on meanwhile (stale tag, P5 §4.1). After a resume
 * on the bot's turn the same request is rebuilt from the restored state, so the bot plays the same move (AC-11).
 */
export function useMatch(): UseMatch {
  const { index } = useLexicon();
  const services = useContext(MatchServicesContext);
  const session = useMatchSession();
  const runner = useMemo(() => services.createBotRunner(index), [services, index]);
  const model = session?.model ?? null;
  const dispatch = session?.dispatch ?? noop;
  const now = session?.now ?? zero;

  const state = model?.state;
  const failed = model?.failure !== null;
  useEffect(() => {
    if (state === undefined || failed) return;
    if (state.status !== 'in_progress' || state.seatOnTurn !== BOT_SEAT) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tag = state.actionCount;
    const requestedAt = now();
    const delay = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, services.thinkDelayMs());
    });
    const decision = runner.decide(botRequestFor(state, BOT_SEAT, PLAY_BOT)).then(
      (result) => ({
        type: 'bot_decided' as const,
        tag,
        result,
        timing: { requestedAt, resolvedAt: now() },
      }),
      () => ({ type: 'bot_failed' as const, tag }),
    );
    void Promise.all([decision, delay]).then(([command]) => {
      if (active) dispatch(command);
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [state, failed, runner, services, dispatch, now]);

  return {
    model,
    startFailed: session?.startFailed ?? false,
    dispatch,
    restart: session?.startNew ?? noop,
  };
}
