/**
 * Suite `bots/decisions-b2-r1` (bots-api §5.6, spec AC-12; ADR-0016 §D3 item 3): every pinned decision of
 * `decisions-b2-r1.json` recomputed with `chooseAction` on the shipped automaton (f1: `.clxi` with GADDAG) at the
 * pinned position. Case `fixture` checks the file header against this build (BOT_VERSION, rules version, lexicon
 * version, automaton); case `<seed>/<actions>/<personality>` reports the action key and budget counters.
 */
import { observe, isSeedHex, type SeedHex } from '@codelex/game-engine';
import { actionKey, BOT_VERSION, chooseAction, type BotPersonalityId } from '@codelex/bots';
import type { LexiconIndex } from '@codelex/lexicon/index';

import { bit, CaseError, lazy, unwrap, type CaseSpec } from '../cases.js';
import { BOT_DECISIONS_PATH, type GoldenCorpus } from '../corpus.js';
import {
  beginnerPosition,
  botContext,
  botRng,
  syntheticClxiIndex,
} from '../fixtures/bot-fixtures.js';

export const BOTS_SUITE = 'bots/decisions-b2-r1';

/** The fixture of the bots golden test: 2,000 synthetic forms, seed word 1. */
const FIXTURE_SIZE = 2000;
const FIXTURE_SEED_WORD = 1;

const PERSONALITY_IDS: readonly BotPersonalityId[] = [
  'random-legal',
  'beginner',
  'greedy',
  'strategist',
];

function personalityOf(id: string): BotPersonalityId {
  const found = PERSONALITY_IDS.find((p) => p === id);
  if (found === undefined) throw new CaseError('CORPUS_MALFORMED');
  return found;
}

function seedOf(seed: string): SeedHex {
  if (!isSeedHex(seed)) throw new CaseError('CORPUS_MALFORMED');
  return seed as SeedHex;
}

export function botCases(corpus: GoldenCorpus): CaseSpec[] {
  const golden = corpus[BOT_DECISIONS_PATH];
  const lexicon = lazy((): LexiconIndex => syntheticClxiIndex(FIXTURE_SIZE, FIXTURE_SEED_WORD));
  const positions = new Map<string, ReturnType<typeof beginnerPosition>>();
  const positionAt = (seed: SeedHex, actions: number): ReturnType<typeof beginnerPosition> => {
    const key = `${seed}/${String(actions)}`;
    let state = positions.get(key);
    if (state === undefined) {
      state = beginnerPosition(lexicon(), seed, actions);
      positions.set(key, state);
    }
    return state;
  };

  const header: CaseSpec = {
    id: 'fixture',
    run: () => {
      const index = lexicon();
      return {
        observed: {
          botVersion: BOT_VERSION,
          engineRulesVersion: 1,
          lexiconVersion: index.version,
          automaton: index.gaddag === undefined ? 'dawg' : 'gaddag',
        },
        expected: {
          botVersion: golden.botVersion,
          engineRulesVersion: golden.engineRulesVersion,
          lexiconVersion: golden.lexiconVersion,
          automaton: golden.automaton,
        },
      };
    },
  };

  const decisions: CaseSpec[] = golden.decisions.map((d) => ({
    id: `${d.seed}/${String(d.actions)}/${d.personality}`,
    run: () => {
      const seed = seedOf(d.seed);
      const personality = personalityOf(d.personality);
      const state = positionAt(seed, d.actions);
      const observation = observe(state, state.seatOnTurn);
      const decision = unwrap(
        chooseAction(
          observation,
          botContext(
            lexicon(),
            personality,
            botRng(seed, observation.seatOnTurn, observation.actionCount),
          ),
        ),
      );
      const { action } = decision;
      if (action.type === 'RESIGN') throw new CaseError('BOT_RESIGNED');
      return {
        observed: {
          key: actionKey(action),
          nodesUsed: decision.nodesUsed,
          candidatesEvaluated: decision.candidatesEvaluated,
          budgetExhausted: bit(decision.budgetExhausted),
        },
        expected: {
          key: d.key,
          nodesUsed: d.nodesUsed,
          candidatesEvaluated: d.candidatesEvaluated,
          budgetExhausted: bit(d.budgetExhausted),
        },
      };
    },
  }));

  return [header, ...decisions];
}
