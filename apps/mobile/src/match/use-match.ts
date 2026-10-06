import { createMatch, type EngineContext, type SeedHex } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { getRandomBytes } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useLexicon } from '../lexicon/lexicon-gate';
import { botRequestFor, createJsThreadBotRunner, type BotRunner } from './bot-runner';
import { reduceMatch, startModel, type MatchCommand, type MatchModel } from './match-model';
import { BOT_SEAT, PLAY_BOT, playMatchConfig, seedFromBytes, thinkDelayMs } from './play-config';

/** Platform effects of a match, injected so tests can pin the seed, the pace and the bot runtime. */
export interface MatchServices {
  /** A fresh 64-bit seed per match (CSPRNG on device). */
  readonly newSeed: () => SeedHex;
  /** The bot runtime (P5 option A today; a worker runtime later behind the same seam). */
  readonly createBotRunner: (lexicon: LexiconIndex) => BotRunner;
  /** Presentation delay of one bot move (D-29); never enters the engine. */
  readonly thinkDelayMs: () => number;
  /** Uniform [0, 1) for Shuffle (AC-7): a local rack order only, never an engine input. */
  readonly shuffleRandom: () => number;
}

export const DEVICE_MATCH_SERVICES: MatchServices = {
  newSeed: () => seedFromBytes(getRandomBytes(8)),
  createBotRunner: (lexicon) => createJsThreadBotRunner(lexicon),
  // Presentation only (pace, rack order), so a non-seeded source is fine; game randomness comes from the seed.
  thinkDelayMs: () => thinkDelayMs(Math.random),
  shuffleRandom: Math.random,
};

export const MatchServicesContext = createContext<MatchServices>(DEVICE_MATCH_SERVICES);

export interface UseMatch {
  /** Null when the engine refused to create the match (`match.start.error`). */
  readonly model: MatchModel | null;
  readonly dispatch: (command: MatchCommand) => void;
  /** A new match with a new seed (Play again, Try again). */
  readonly restart: () => void;
}

/**
 * One local match vs the bot. The engine is the only source of outcomes; this hook only sequences it: player
 * commands go through `reduceMatch`, and on the bot's turn the request is computed by the runner while the think
 * delay runs, then applied at max(compute, delay) (D-29), unless the match moved on meanwhile (stale tag, P5 §4.1).
 */
export function useMatch(): UseMatch {
  const { index } = useLexicon();
  const services = useContext(MatchServicesContext);
  const ctx = useMemo<EngineContext>(() => ({ lexicon: index }), [index]);
  const runner = useMemo(() => services.createBotRunner(index), [services, index]);

  const create = useCallback((): MatchModel | null => {
    const created = createMatch(playMatchConfig(services.newSeed(), index), ctx);
    return created.ok ? startModel(created.value.state) : null;
  }, [services, index, ctx]);

  const [model, setModel] = useState<MatchModel | null>(create);

  const dispatch = useCallback(
    (command: MatchCommand) => {
      setModel((current) => (current === null ? current : reduceMatch(current, command, ctx)));
    },
    [ctx],
  );

  const restart = useCallback(() => {
    setModel(create());
  }, [create]);

  const state = model?.state;
  const failed = model?.failure !== null;
  useEffect(() => {
    if (state === undefined || failed) return;
    if (state.status !== 'in_progress' || state.seatOnTurn !== BOT_SEAT) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tag = state.actionCount;
    const delay = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, services.thinkDelayMs());
    });
    const decision = runner.decide(botRequestFor(state, BOT_SEAT, PLAY_BOT)).then(
      (result) => ({ type: 'bot_decided' as const, tag, result }),
      () => ({ type: 'bot_failed' as const, tag }),
    );
    void Promise.all([decision, delay]).then(([command]) => {
      if (active) dispatch(command);
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [state, failed, runner, services, dispatch]);

  return { model, dispatch, restart };
}
