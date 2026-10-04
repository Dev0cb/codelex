/**
 * Classic scoring (R-SCORE-001…005, R-SCORE-007, R-SCORE-008, R-SCORE-009): no tech squares (no registered
 * layout has any) and no powers, so steps 2 and 3 of the pipeline are always 0. Every step is an integer; nothing
 * is ever divided. The constants come from the match's `Rules` (ADR-0014 §D1, §D5: the term bonus is
 * `rules.termBonus[difficulty]`, never the lexicon `gameValue`).
 */
import type { CheckedPlacement, FormedWord, ResolvedWord } from '../placement/check.js';
import { squareKind } from '../rules/constants.js';
import { tileValue } from '../tiles.js';
import type {
  EngineLexicon,
  Layout,
  LetterTable,
  PreviewScore,
  Rules,
  ScoreBreakdown,
  WordScore,
} from '../types.js';

const LETTER_MULT: Readonly<Record<string, number>> = { DL: 2, TL: 3 };
const WORD_MULT: Readonly<Record<string, number>> = { DW: 2, TW: 3 };

interface Base {
  readonly letterSum: number;
  readonly wordMult: number;
  readonly base: number;
}

/** R-SCORE-001: premiums only on newly covered squares; blanks are 0 (R-BAG-006). */
export function wordBase(word: FormedWord, layout: Layout, letters: LetterTable): Base {
  let letterSum = 0;
  let wordMult = 1;
  for (const cell of word.cells) {
    const value = tileValue(letters, cell.tile);
    if (!cell.isNew) {
      letterSum += value;
      continue;
    }
    const kind = squareKind(layout, cell.row, cell.col);
    letterSum += value * (LETTER_MULT[kind] ?? 1);
    wordMult *= WORD_MULT[kind] ?? 1;
  }
  return { letterSum, wordMult, base: letterSum * wordMult };
}

/** The mover's chain context (R-SCORE-005). */
export interface ChainContext {
  /** The mover's previous main word as its played form, "" if none. */
  readonly lastMainForm: string;
  /** The mover's chain length before this move, 0..5. */
  readonly chainK: number;
}

/**
 * R-SCORE-005 with R-CORE-006 resolution: the main word links iff its canonical term differs from the canonical
 * term of the previous main form and the two are related (undirected, in-profile). Returns k after the move.
 */
export function chainAfter(
  mainRef: ResolvedWord['ref'],
  context: ChainContext,
  lexicon: EngineLexicon,
  rules: Rules,
): number {
  if (context.lastMainForm === '') return 0;
  const previous = lexicon.lookup(context.lastMainForm);
  if (previous === undefined) return 0;
  const a = lexicon.termOf(previous);
  const b = lexicon.termOf(mainRef);
  if (a === b || lexicon.related(a, b) === 0) return 0;
  return Math.min(context.chainK + 1, rules.chainCap);
}

/** R-SCORE-008 breakdown of a checked placement (main word first, as `checkPlacement` returns them). */
export function scorePlacement(
  placement: CheckedPlacement,
  layout: Layout,
  letters: LetterTable,
  context: ChainContext,
  lexicon: EngineLexicon,
  rules: Rules,
): ScoreBreakdown {
  const words: WordScore[] = placement.words.map((word) => {
    const { letterSum, wordMult, base } = wordBase(word, layout, letters);
    const term = lexicon.meta(lexicon.termOf(word.ref));
    const termBonus = rules.termBonus[term.difficulty];
    return {
      form: word.form,
      termId: term.id,
      canonicalForm: term.form,
      difficulty: term.difficulty,
      main: word.main,
      start: word.start,
      direction: word.direction,
      letterSum,
      wordMult,
      base,
      techBonus: 0,
      compileBonus: 0,
      termBonus,
      total: base + termBonus,
    };
  });
  const tilesPlaced = placement.tiles.length;
  const fullStack = tilesPlaced === rules.fullStackTiles ? rules.fullStackBonus : 0;
  const main = placement.words[0] as ResolvedWord;
  const chainKAfter = chainAfter(main.ref, context, lexicon, rules);
  const chain = rules.chainStep * chainKAfter;
  const total = words.reduce((sum, w) => sum + w.total, 0) + fullStack + chain;
  return { words, tilesPlaced, fullStack, chain, chainKAfter, total };
}

/** R-SCORE-009: premiums and Full Stack only, never the lexicon (it is not even a parameter). */
export function previewPlacement(
  words: readonly FormedWord[],
  tilesPlaced: number,
  layout: Layout,
  letters: LetterTable,
  rules: Rules,
): PreviewScore {
  const scored = words.map((word) => ({
    form: word.form,
    main: word.main,
    start: word.start,
    direction: word.direction,
    ...wordBase(word, layout, letters),
  }));
  const fullStack = tilesPlaced === rules.fullStackTiles ? rules.fullStackBonus : 0;
  return {
    words: scored,
    fullStack,
    total: scored.reduce((sum, w) => sum + w.base, 0) + fullStack,
  };
}
