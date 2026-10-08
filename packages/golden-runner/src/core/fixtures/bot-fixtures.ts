/**
 * Fixtures of the bots golden (`packages/bots/test/golden/decisions-b<N>-r<R>.json`, bots-api §5.6), rebuilt with
 * public APIs only and no Node API (ADR-0016 §D3 item 3): the seeded 2,000-form synthetic lexicon as a built and
 * decoded `.clxi` with its GADDAG (f1, what the app ships) and the Beginner mirror-game positions. Same
 * construction as `packages/bots/test/support/lexicons.ts` (`syntheticIndex`) and `match.ts` (`positionAfter`,
 * `botRng`, `contextFor`). Fixture code, not rules: a drift changes the lexicon version or the decisions, so the
 * `bots/*` cases fail on every runtime, never pass wrongly.
 */
import {
  apply,
  createMatch,
  getLetterTable,
  observe,
  type MatchConfig,
  type MatchState,
  type SeedHex,
} from '@codelex/game-engine';
import { createRng, deriveRng, type Rng } from '@codelex/game-engine/rng';
import { chooseAction, PERSONALITIES, type BotContext, type BotPersonalityId } from '@codelex/bots';
import {
  buildLexiconIndex,
  decodeLexiconIndex,
  type DefinitionHash,
  type Difficulty,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';

import { CaseError, unwrap } from '../cases.js';

const TEST_PROFILE = {
  id: 'global-ranked',
  kind: 'global',
  definitionHash: 'fedcba9876543210' as DefinitionHash,
} as const;

const LENGTH_WEIGHTS: readonly (readonly [number, number])[] = [
  [2, 4],
  [3, 14],
  [4, 18],
  [5, 18],
  [6, 15],
  [7, 12],
  [8, 9],
  [9, 5],
  [10, 3],
  [11, 1],
  [12, 1],
];

const DIFFICULTIES: readonly Difficulty[] = ['novice', 'intermediate', 'advanced', 'expert'];

function weightedPick(weights: readonly number[], draw: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i] ?? 0;
    if (draw < acc) return i;
  }
  return weights.length - 1;
}

/**
 * `syntheticIndex(size, seedWord, { clxi: true })` of the bots' tests: `size` distinct forms of length 2–12 drawn
 * with the `letters-v1` frequencies, uniform difficulties, built to a `.clxi` (format 1, GADDAG) and decoded.
 */
export function syntheticClxiIndex(size: number, seedWord: number): LexiconIndex {
  const rng = createRng([seedWord >>> 0 || 1, size >>> 0, 0x9e3779b9, 0x7f4a7c15]);
  const letterWeights = getLetterTable('letters-v1').counts;
  const letterTotal = letterWeights.reduce((a, b) => a + b, 0);
  const lengthTotal = LENGTH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  const forms = new Set<string>();
  const terms: ReferenceTermInput[] = [];
  while (terms.length < size) {
    const lengthIndex = weightedPick(
      LENGTH_WEIGHTS.map(([, w]) => w),
      rng.int(0, lengthTotal),
    );
    const length = LENGTH_WEIGHTS[lengthIndex]?.[0] ?? 4;
    let form = '';
    for (let i = 0; i < length; i += 1) {
      form += String.fromCharCode(65 + weightedPick(letterWeights, rng.int(0, letterTotal)));
    }
    if (forms.has(form)) continue;
    forms.add(form);
    terms.push({
      id: `t${String(terms.length)}`,
      playable: true,
      form,
      difficulty: DIFFICULTIES[rng.int(0, 4)] ?? 'novice',
      categories: ['networking'],
      inflections: [],
      relations: [],
      gameValue: 1,
      knowledgeXp: 1,
    });
  }
  const version = (size.toString(16).padStart(8, '0') + '00000000').slice(0, 16);
  const built = buildLexiconIndex(
    { version, profile: TEST_PROFILE, document: { terms }, blocklist: [] },
    { formatVersion: 1, gaddag: true },
  );
  if (!built.ok) throw new CaseError(built.error.code);
  return unwrap(
    decodeLexiconIndex(built.value, {
      version: version as LexiconVersion,
      profileId: TEST_PROFILE.id,
    }),
  );
}

function configFor(lexicon: LexiconIndex, seed: SeedHex): MatchConfig {
  return {
    seed,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[0], [1]],
      layout: 'classic-v1',
      letters: 'letters-v1',
      requireWinner: 0,
    },
  };
}

/** The host's per-decision stream `bot:<seat>:<actionCount>` (ADR-0013 §D1, BOT-2). */
export function botRng(seed: SeedHex, seat: number, actionCount: number): Rng {
  return deriveRng(seed, `bot:${String(seat)}:${String(actionCount)}`);
}

export function botContext(
  lexicon: LexiconIndex,
  personality: BotPersonalityId,
  rng: Rng,
): BotContext {
  return { lexicon, rng, personality, budget: PERSONALITIES[personality].budget };
}

/** The state after `actions` accepted actions of a Beginner mirror game from `seed` (`positionAfter`). */
export function beginnerPosition(
  lexicon: LexiconIndex,
  seed: SeedHex,
  actions: number,
): MatchState {
  let state = unwrap(createMatch(configFor(lexicon, seed), { lexicon })).state;
  while (state.status === 'in_progress' && state.actionCount < actions) {
    const observation = observe(state, state.seatOnTurn);
    const decided = unwrap(
      chooseAction(
        observation,
        botContext(lexicon, 'beginner', botRng(seed, state.seatOnTurn, observation.actionCount)),
      ),
    );
    state = unwrap(apply(state, decided.action, { lexicon })).state;
  }
  if (state.status !== 'in_progress') throw new CaseError('POSITION_ENDED');
  return state;
}
