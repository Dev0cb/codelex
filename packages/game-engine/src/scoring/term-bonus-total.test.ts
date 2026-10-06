import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CTX, config1v1 } from '../../test/support/small-lexicon.js';
import { apply } from '../match/apply.js';
import { createMatch } from '../match/create.js';
import type { ScoreBreakdown, WordScore } from '../types.js';
import { termBonusTotal } from './score.js';

const word = (termBonus: number, main: boolean): WordScore => ({
  form: 'AI',
  termId: 'ai',
  canonicalForm: 'AI',
  difficulty: 'novice',
  main,
  start: { row: 7, col: 7 },
  direction: 'row',
  letterSum: 2,
  wordMult: 1,
  base: 2,
  techBonus: 0,
  compileBonus: 0,
  termBonus,
  total: 2 + termBonus,
});

describe('termBonusTotal (R-SCORE-003, P-SCORE-009-c)', () => {
  it('is the sum of every word term bonus, main and cross words alike', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(0, 4, 8, 16), { minLength: 1, maxLength: 8 }),
        (bonuses) => {
          const breakdown: ScoreBreakdown = {
            words: bonuses.map((b, i) => word(b, i === 0)),
            tilesPlaced: 2,
            fullStack: 0,
            chain: 0,
            chainKAfter: 0,
            total: 0,
          };
          expect(termBonusTotal(breakdown)).toBe(bonuses.reduce((a: number, b) => a + b, 0));
        },
      ),
    );
  });

  it('closes the R-SCORE-008 sum of a committed move', () => {
    const created = createMatch(config1v1(), CTX);
    if (!created.ok) throw new Error('fixture');
    const start = {
      ...created.value.state,
      seatOnTurn: 0,
      seats: created.value.state.seats.map((s, i) => (i === 0 ? { ...s, rack: 'AEIMNST' } : s)),
    };
    const applied = apply(
      start,
      {
        seat: 0,
        type: 'PLACE_WORD',
        tiles: [
          { row: 7, col: 7, tile: 'A' },
          { row: 7, col: 8, tile: 'I' },
        ],
      },
      CTX,
    );
    if (!applied.ok) throw new Error(applied.error.message);
    const placed = applied.value.events.find((e) => e.type === 'WORD_PLACED');
    if (placed?.type !== 'WORD_PLACED') throw new Error('no WORD_PLACED');
    const b = placed.breakdown;
    const base = b.words.reduce((sum, w) => sum + w.base + w.techBonus + w.compileBonus, 0);
    expect(base + termBonusTotal(b) + b.fullStack + b.chain).toBe(b.total);
  });
});
