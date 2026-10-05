import { chooseAction, PERSONALITIES } from '@codelex/bots';
import { apply, deriveRng, observe, type MatchState } from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { botRequestFor, createJsThreadBotRunner, type BotRequest } from './bot-runner';
import { PLAY_BOT } from './play-config';
import { loadBundledLexicon, newPlayState, seedOf } from './test-support';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

const immediate = (): Promise<void> => Promise.resolve();

/** Plays `turns` actions of a Beginner mirror match and returns every on-turn position on the way. */
function positions(seedNumber: number, turns: number): MatchState[] {
  let state = newPlayState(seedOf(seedNumber), lexicon);
  const seen: MatchState[] = [];
  for (let i = 0; i < turns && state.status === 'in_progress'; i += 1) {
    seen.push(state);
    const seat = state.seatOnTurn;
    const decided = chooseAction(observe(state, seat), {
      lexicon: lexicon.index,
      rng: deriveRng(state.seed, `bot:${String(seat)}:${String(state.actionCount)}`),
      personality: PLAY_BOT,
      budget: PERSONALITIES[PLAY_BOT].budget,
    });
    if (!decided.ok) throw new Error(decided.error.message);
    const applied = apply(state, decided.value.action, { lexicon: lexicon.index });
    if (!applied.ok) throw new Error(applied.error.message);
    state = applied.value.state;
  }
  return seen;
}

describe('BotRunner seam (P5 §4.1)', () => {
  it('builds a plain-data request: the legal observation and the RNG state, never the seed', () => {
    const state = positions(11, 1)[0] as MatchState;
    const request = botRequestFor(state, state.seatOnTurn, PLAY_BOT);
    expect(request.observation).toEqual(observe(state, state.seatOnTurn));
    expect(request.rngState).toEqual(
      deriveRng(state.seed, `bot:${String(state.seatOnTurn)}:0`).state(),
    );
    expect(Object.keys(request).sort()).toEqual(['observation', 'personality', 'rngState']);
    const json = JSON.stringify(request);
    expect(json).not.toContain(state.seed);
    expect(json).not.toContain(state.bag);
    // Only the bot's own rack crosses the seam (AC-8): the other seat's rack is a count.
    expect(request.observation.rack).toBe(state.seats[state.seatOnTurn]?.rack);
    expect(JSON.parse(json)).toEqual(request);
  });

  it('decides exactly what chooseAction decides with the bot:<seat>:<n> stream, across a JSON round trip', async () => {
    const runner = createJsThreadBotRunner(lexicon.index, { nextFrame: immediate });
    const states = [...positions(21, 12), ...positions(22, 12)];
    expect(states.length).toBeGreaterThanOrEqual(20);
    for (const state of states) {
      const seat = state.seatOnTurn;
      const direct = chooseAction(observe(state, seat), {
        lexicon: lexicon.index,
        rng: deriveRng(state.seed, `bot:${String(seat)}:${String(state.actionCount)}`),
        personality: PLAY_BOT,
        budget: PERSONALITIES[PLAY_BOT].budget,
      });
      const copied = JSON.parse(JSON.stringify(botRequestFor(state, seat, PLAY_BOT))) as BotRequest;
      const viaRunner = await runner.decide(copied);
      expect(viaRunner.ok && direct.ok).toBe(true);
      if (!viaRunner.ok || !direct.ok) return;
      expect(viaRunner.value).toEqual(direct.value);
    }
  });

  it('waits for the next frame before computing, so the thinking indicator paints first', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const frame = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = createJsThreadBotRunner(lexicon.index, {
      nextFrame: () => {
        order.push('frame requested');
        return frame;
      },
    });
    const state = positions(31, 1)[0] as MatchState;
    const pending = runner.decide(botRequestFor(state, state.seatOnTurn, PLAY_BOT)).then((r) => {
      order.push('decided');
      return r;
    });
    await Promise.resolve();
    expect(order).toEqual(['frame requested']);
    release();
    expect((await pending).ok).toBe(true);
    expect(order).toEqual(['frame requested', 'decided']);
  });

  it('returns the bot error for an observation that is not on turn', async () => {
    const runner = createJsThreadBotRunner(lexicon.index, { nextFrame: immediate });
    const state = positions(41, 1)[0] as MatchState;
    const offTurn = 1 - state.seatOnTurn;
    const result = await runner.decide(botRequestFor(state, offTurn, PLAY_BOT));
    expect(result).toMatchObject({ ok: false, error: { kind: 'bot', code: 'NOT_ON_TURN' } });
  });

  it('defaults to requestAnimationFrame for the frame wait', async () => {
    const raf = jest.spyOn(globalThis, 'requestAnimationFrame');
    const runner = createJsThreadBotRunner(lexicon.index);
    const state = positions(51, 1)[0] as MatchState;
    expect((await runner.decide(botRequestFor(state, state.seatOnTurn, PLAY_BOT))).ok).toBe(true);
    expect(raf).toHaveBeenCalled();
    raf.mockRestore();
  });
});
