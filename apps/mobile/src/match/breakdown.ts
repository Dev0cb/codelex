/**
 * Score explanation (E-1.5 AC-4, D-14, §5.5.4): the engine's `ScoreBreakdown` rendered verbatim as i18n notices,
 * in R-SCORE-008 order. Nothing here adds, multiplies or decides: every number is a field the engine computed.
 * Tech-square and Compile components are never rendered (always 0 in rules version 1; tech squares off, AC-3).
 */
import type { Difficulty, ScoreBreakdown } from '@codelex/game-engine';
import type { MessageKey } from '@codelex/i18n';

import type { Notice } from './match-model';

/** Difficulty labels shared with the Knowledge Card (§10.4 `card.difficulty.*`). */
export const DIFFICULTY_KEY: Readonly<Record<Difficulty, MessageKey>> = {
  novice: 'card.difficulty.novice',
  intermediate: 'card.difficulty.intermediate',
  advanced: 'card.difficulty.advanced',
  expert: 'card.difficulty.expert',
};

export interface BreakdownLine {
  readonly kind: 'word' | 'detail' | 'bonus' | 'total';
  readonly notice: Notice;
  /** Translated by the UI into the `difficulty` argument of `notice`. */
  readonly difficultyKey?: MessageKey;
}

/** Chips of the status strip: only the components the engine awarded, never colour alone (icon/text). */
export function breakdownChips(breakdown: ScoreBreakdown): Notice[] {
  const chips: Notice[] = [];
  const main = breakdown.words.find((w) => w.main);
  if (main !== undefined && main.wordMult > 1) {
    chips.push({ key: 'match.breakdown.chip.word_mult', params: { n: main.wordMult } });
  }
  const term = breakdown.words.reduce((sum, w) => sum + w.termBonus, 0);
  if (term > 0) chips.push({ key: 'match.breakdown.chip.term', params: { points: term } });
  if (breakdown.fullStack > 0) {
    chips.push({ key: 'match.breakdown.full_stack', params: { points: breakdown.fullStack } });
  }
  if (breakdown.chain > 0) {
    chips.push({ key: 'match.breakdown.chip.chain', params: { points: breakdown.chain } });
  }
  return chips;
}

/** The full breakdown sheet: per word (main first), then Full Stack, chain and the total. */
export function breakdownLines(
  breakdown: ScoreBreakdown,
  chainFrom: string | null,
): BreakdownLine[] {
  const lines: BreakdownLine[] = [];
  for (const word of breakdown.words) {
    lines.push({
      kind: 'word',
      notice: word.main
        ? { key: 'match.breakdown.word', params: { form: word.form, base: word.base } }
        : { key: 'match.breakdown.cross_word', params: { form: word.form } },
    });
    lines.push({
      kind: 'detail',
      notice: {
        key: 'match.breakdown.calc',
        params: { letters: word.letterSum, mult: word.wordMult, base: word.base },
      },
    });
    if (word.termBonus > 0) {
      lines.push({
        kind: 'detail',
        notice: { key: 'match.breakdown.term', params: { points: word.termBonus } },
        difficultyKey: DIFFICULTY_KEY[word.difficulty],
      });
    }
  }
  if (breakdown.fullStack > 0) {
    lines.push({
      kind: 'bonus',
      notice: { key: 'match.breakdown.full_stack', params: { points: breakdown.fullStack } },
    });
  }
  if (breakdown.chain > 0) {
    const main = breakdown.words.find((w) => w.main);
    lines.push({
      kind: 'bonus',
      notice: {
        key: 'match.breakdown.chain',
        params: { points: breakdown.chain, from: chainFrom ?? '', to: main?.canonicalForm ?? '' },
      },
    });
  }
  lines.push({
    kind: 'total',
    notice: { key: 'match.breakdown.total', params: { points: breakdown.total } },
  });
  return lines;
}
