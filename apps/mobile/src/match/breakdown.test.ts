import type { ScoreBreakdown, WordScore } from '@codelex/game-engine';
import { describe, expect, it } from '@jest/globals';

import { breakdownChips, breakdownLines } from './breakdown';

const word = (over: Partial<WordScore>): WordScore => ({
  form: 'PODS',
  termId: 'pod',
  canonicalForm: 'POD',
  difficulty: 'intermediate',
  main: true,
  start: { row: 7, col: 7 },
  direction: 'row',
  letterSum: 7,
  wordMult: 2,
  base: 14,
  techBonus: 0,
  compileBonus: 0,
  termBonus: 8,
  total: 22,
  ...over,
});

const full: ScoreBreakdown = {
  words: [
    word({}),
    word({
      form: 'OK',
      termId: 'ok',
      canonicalForm: 'OK',
      difficulty: 'novice',
      main: false,
      letterSum: 6,
      wordMult: 1,
      base: 6,
      termBonus: 0,
      total: 6,
    }),
  ],
  tilesPlaced: 7,
  fullStack: 50,
  chain: 10,
  chainKAfter: 2,
  total: 88,
};

describe('score explanation chips (D-14)', () => {
  it('shows only the components the engine awarded, word multiplier of the main word first', () => {
    expect(breakdownChips(full)).toEqual([
      { key: 'match.breakdown.chip.word_mult', params: { n: 2 } },
      { key: 'match.breakdown.chip.term', params: { points: 8 } },
      { key: 'match.breakdown.full_stack', params: { points: 50 } },
      { key: 'match.breakdown.chip.chain', params: { points: 10 } },
    ]);
  });

  it('shows nothing for a plain word', () => {
    expect(
      breakdownChips({
        words: [word({ wordMult: 1, base: 7, termBonus: 0, total: 7 })],
        tilesPlaced: 2,
        fullStack: 0,
        chain: 0,
        chainKAfter: 0,
        total: 7,
      }),
    ).toEqual([]);
  });
});

describe('breakdown sheet (AC-4: R-SCORE-008 order, engine values verbatim)', () => {
  it('lists main word, cross-words, Full Stack, chain and total', () => {
    expect(breakdownLines(full, 'KUBERNETES')).toEqual([
      { kind: 'word', notice: { key: 'match.breakdown.word', params: { form: 'PODS', base: 14 } } },
      {
        kind: 'detail',
        notice: { key: 'match.breakdown.calc', params: { letters: 7, mult: 2, base: 14 } },
      },
      {
        kind: 'detail',
        notice: { key: 'match.breakdown.term', params: { points: 8 } },
        difficultyKey: 'card.difficulty.intermediate',
      },
      {
        kind: 'word',
        notice: { key: 'match.breakdown.cross_word', params: { form: 'OK' } },
      },
      {
        kind: 'detail',
        notice: { key: 'match.breakdown.calc', params: { letters: 6, mult: 1, base: 6 } },
      },
      { kind: 'bonus', notice: { key: 'match.breakdown.full_stack', params: { points: 50 } } },
      {
        kind: 'bonus',
        notice: {
          key: 'match.breakdown.chain',
          params: { points: 10, from: 'KUBERNETES', to: 'POD' },
        },
      },
      { kind: 'total', notice: { key: 'match.breakdown.total', params: { points: 88 } } },
    ]);
  });

  it('never renders a tech-square or Compile line (always 0 in rules version 1, AC-3)', () => {
    const lines = breakdownLines(
      { ...full, words: [word({ techBonus: 0, compileBonus: 0 })] },
      null,
    );
    expect(lines.map((l) => l.notice.key).filter((k) => /tech|compile/.test(k))).toEqual([]);
    // Without a known previous term the chain line still names this term.
    expect(lines.find((l) => l.notice.key === 'match.breakdown.chain')?.notice.params).toEqual({
      points: 10,
      from: '',
      to: 'POD',
    });
  });
});
