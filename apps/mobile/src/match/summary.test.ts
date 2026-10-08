/**
 * E-1.5 AC-10 / design §5.6: the summary of a finished match. Scripted full matches are played through the model,
 * an independent engine replica applies the same actions, and every number the summary shows must equal the
 * replica's (0 mismatches). Both a natural ending and a resignation are covered.
 */
import {
  apply,
  observe,
  type Action,
  type EngineContext,
  type MatchEvent,
  type MatchState,
} from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { reduceMatch, startModel, type MatchCommand, type MatchModel } from './match-model';
import { BOT_SEAT, HUMAN_SEAT } from './play-config';
import { summarize } from './summary';
import {
  humanStarts,
  loadBundledLexicon,
  newPlayState,
  placeCommands,
  scriptedAction,
  seedWhereFirst,
} from './test-support';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
let ctx: EngineContext;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  ctx = { lexicon: lexicon.index };
});

const run = (model: MatchModel, ...commands: MatchCommand[]): MatchModel =>
  commands.reduce((m, c) => reduceMatch(m, c, ctx), model);

interface Played {
  readonly model: MatchModel;
  readonly replica: MatchState;
  readonly events: MatchEvent[];
}

/** Plays through the model and a replica in lockstep; `stopAfter` = resign after that many actions. */
function playMatch(seedState: MatchState, stopAfter?: number): Played {
  let model = startModel(seedState);
  let replica = seedState;
  const events: MatchEvent[] = [];
  const step = (action: Action, commands: MatchCommand[]): void => {
    model = run(model, ...commands);
    const applied = apply(replica, action, ctx);
    if (!applied.ok) throw new Error(applied.error.message);
    replica = applied.value.state;
    events.push(...applied.value.events);
    expect(model.state).toEqual(replica);
  };
  while (replica.status === 'in_progress') {
    if (stopAfter !== undefined && replica.actionCount >= stopAfter) {
      step({ seat: HUMAN_SEAT, type: 'RESIGN' }, [{ type: 'resign' }]);
      break;
    }
    const action = scriptedAction(replica, `summary:${String(replica.actionCount)}`, lexicon);
    if (replica.seatOnTurn === BOT_SEAT) {
      step(action, [
        {
          type: 'bot_decided',
          tag: replica.actionCount,
          result: {
            ok: true,
            value: {
              action,
              nodesUsed: 1,
              candidatesEvaluated: 1,
              candidatesRefused: 0,
              budgetExhausted: false,
            },
          },
        },
      ]);
    } else if (action.type === 'PLACE_WORD') {
      step(action, [...placeCommands(model, action), { type: 'play' }]);
    } else if (action.type === 'EXCHANGE') {
      const used = new Set<number>();
      const slotIds = action.tiles.map((tile) => {
        const slot = model.slots.find((s) => !used.has(s.id) && s.tile === tile);
        if (slot === undefined) throw new Error('no slot for the exchange');
        used.add(slot.id);
        return slot.id;
      });
      step(action, [{ type: 'exchange', slotIds }]);
    } else {
      step({ seat: HUMAN_SEAT, type: 'PASS' }, [{ type: 'pass' }]);
    }
  }
  return { model, replica, events };
}

interface ExpectedBest {
  form: string;
  points: number;
  seat: number;
  termId: string;
  canonicalForm: string;
}

/**
 * Independent reading of the replica's events: best turn (D-15 tie rules), canonical terms per seat, and per term
 * the forms each seat played in order (for "Played as", E-1.7 AC-12).
 */
function fromEvents(events: readonly MatchEvent[]) {
  let best: ExpectedBest | null = null;
  const terms: [Set<string>, Set<string>] = [new Set(), new Set()];
  const forms: [Map<string, string[]>, Map<string, string[]>] = [
    new Map<string, string[]>(),
    new Map<string, string[]>(),
  ];
  for (const event of events) {
    if (event.type !== 'WORD_PLACED') continue;
    const main = event.breakdown.words.find((w) => w.main);
    if (main === undefined) continue;
    for (const w of event.breakdown.words) {
      terms[event.seat]?.add(w.termId);
      forms[event.seat]?.set(w.termId, [...(forms[event.seat]?.get(w.termId) ?? []), w.form]);
    }
    const points = event.breakdown.total;
    if (
      best === null ||
      points > best.points ||
      (points === best.points && main.form.length > best.form.length)
    ) {
      best = {
        form: main.form,
        points,
        seat: event.seat,
        termId: main.termId,
        canonicalForm: main.canonicalForm,
      };
    }
  }
  return { best, terms, forms };
}

describe('match summary (AC-10)', () => {
  it.each([
    ['the player starts', 11],
    ['the bot starts', 12],
  ])(
    'equals the engine replica after a natural ending (%s)',
    (_case, from) => {
      const seed =
        from === 11 ? humanStarts(lexicon, 1100) : seedWhereFirst(BOT_SEAT, lexicon, 1200);
      const { model, replica, events } = playMatch(newPlayState(seed, lexicon));
      expect(replica.status).toBe('finished');
      expect(replica.result?.end.reason).not.toBe('resign');
      const summary = summarize(model);
      if (summary === null) throw new Error('no summary');
      const view = observe(replica, HUMAN_SEAT);
      const you = view.seats[HUMAN_SEAT]?.score ?? NaN;
      const them = view.seats[BOT_SEAT]?.score ?? NaN;
      expect(summary.you).toBe(you);
      expect(summary.them).toBe(them);
      expect(summary.margin).toBe(Math.abs(you - them));
      expect(summary.adjustments).toEqual({
        you: replica.result?.adjustments[HUMAN_SEAT],
        them: replica.result?.adjustments[BOT_SEAT],
      });
      const places = replica.result?.places ?? [];
      expect(summary.outcome).toBe(
        places[HUMAN_SEAT] === places[BOT_SEAT]
          ? 'draw'
          : places[HUMAN_SEAT] === 1
            ? 'victory'
            : 'defeat',
      );
      expect(summary.end?.key).toMatch(/^summary\.end\.(out_you|out_bot|scoreless)$/);
      expect(summary.botRack).toBe(view.finalRacks?.[BOT_SEAT]);
      const expected = fromEvents(events);
      expect(
        summary.bestWord === null
          ? null
          : { ...summary.bestWord, form: summary.bestWord.form.toUpperCase() },
      ).toEqual(expected.best);
      expect(new Set(summary.terms.you.map((t) => t.termId))).toEqual(expected.terms[HUMAN_SEAT]);
      expect(new Set(summary.terms.bot.map((t) => t.termId))).toEqual(expected.terms[BOT_SEAT]);
      // Chips are deduplicated by canonical term (E-1.7 AC-12).
      expect(summary.terms.you.length).toBe(expected.terms[HUMAN_SEAT].size);
      // "Played as" = the first inflection played, only when the canonical form itself never was.
      for (const [seat, chips] of [
        [HUMAN_SEAT, summary.terms.you],
        [BOT_SEAT, summary.terms.bot],
      ] as const) {
        for (const chip of chips) {
          const played = expected.forms[seat].get(chip.termId) ?? [];
          expect(chip.playedAs).toBe(
            played.includes(chip.form) ? null : (played.find((f) => f !== chip.form) ?? null),
          );
        }
      }
    },
    120_000,
  );

  it('reports a resignation as a defeat with no rack adjustments and no bot rack', () => {
    const { model, replica } = playMatch(newPlayState(humanStarts(lexicon, 1300), lexicon), 6);
    expect(replica.result?.end).toEqual({ reason: 'resign', seat: HUMAN_SEAT });
    const summary = summarize(model);
    if (summary === null) throw new Error('no summary');
    expect(summary.outcome).toBe('defeat');
    expect(summary.adjustments).toBeNull();
    expect(summary.botRack).toBeNull();
    expect(summary.end).toEqual({ key: 'summary.end.resign', params: {} });
    const view = observe(replica, HUMAN_SEAT);
    expect(summary.you).toBe(view.seats[HUMAN_SEAT]?.score);
    expect(summary.them).toBe(view.seats[BOT_SEAT]?.score);
  });

  it('has no summary while the match is in progress, and no best word when nobody scored', () => {
    const state = newPlayState(humanStarts(lexicon), lexicon);
    expect(summarize(startModel(state))).toBeNull();
    const resigned = run(startModel(state), { type: 'resign' });
    const summary = summarize(resigned);
    expect(summary?.bestWord).toBeNull();
    expect(summary?.terms).toEqual({ you: [], bot: [] });
  });
});
