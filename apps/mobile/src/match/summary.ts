/**
 * The end-of-match summary (E-1.5 AC-10, design §5.6, D-15) as plain data. Scores, adjustments, the result and the
 * final racks are the engine's (`observe` of the finished state, R-SCORE-006/007, R-END-003); the best word and the
 * term chips are read from the move log, whose breakdowns are the engine's own. Nothing is recomputed here.
 * "New to you" needs an on-device history and arrives with persistence (slice S3).
 */
import { observe, type Seat } from '@codelex/game-engine';

import {
  endReason,
  matchOutcome,
  type MatchModel,
  type MoveEntry,
  type Notice,
} from './match-model';
import { BOT_SEAT, HUMAN_SEAT } from './play-config';

/** A canonical term chip (E-1.7 AC-12: PODS and POD are one chip "POD"). */
export interface TermChip {
  readonly termId: string;
  readonly form: string;
}

export interface BestWord {
  /** As played (blanks lowercase). */
  readonly form: string;
  readonly points: number;
  readonly seat: Seat;
}

export interface MatchSummary {
  readonly outcome: 'victory' | 'defeat' | 'draw';
  /** Final scores, adjustments included. */
  readonly you: number;
  readonly them: number;
  /** R-SCORE-006 per side; null on a resignation (not applied, and the line is hidden). */
  readonly adjustments: { readonly you: number; readonly them: number } | null;
  readonly end: Notice | null;
  readonly margin: number;
  readonly bestWord: BestWord | null;
  readonly terms: { readonly you: readonly TermChip[]; readonly bot: readonly TermChip[] };
  /** The bot's final rack (public at the end, R-END-003); null on a resignation (§5.6 states). */
  readonly botRack: string | null;
}

type WordEntry = Extract<MoveEntry, { kind: 'word' }>;

/** D-15: highest turn score; ties go to the longer main word, then the earlier turn. */
function bestOf(words: readonly WordEntry[]): BestWord | null {
  let best: WordEntry | null = null;
  for (const entry of words) {
    if (
      best === null ||
      entry.points > best.points ||
      (entry.points === best.points && entry.form.length > best.form.length)
    ) {
      best = entry;
    }
  }
  return best === null ? null : { form: best.form, points: best.points, seat: best.seat };
}

function termsOf(words: readonly WordEntry[], seat: Seat): TermChip[] {
  const seen = new Map<string, TermChip>();
  for (const entry of words) {
    if (entry.seat !== seat) continue;
    for (const word of entry.breakdown.words) {
      if (!seen.has(word.termId)) {
        seen.set(word.termId, { termId: word.termId, form: word.canonicalForm });
      }
    }
  }
  return [...seen.values()];
}

/** The summary of a finished match; null while it runs. */
export function summarize(model: MatchModel): MatchSummary | null {
  const { state } = model;
  const outcome = matchOutcome(state);
  const result = state.result;
  if (outcome === null || result === undefined) return null;
  const view = observe(state, HUMAN_SEAT);
  const you = view.seats[HUMAN_SEAT]?.score ?? 0;
  const them = view.seats[BOT_SEAT]?.score ?? 0;
  const resigned = result.end.reason === 'resign';
  const words = model.log.filter((e): e is WordEntry => e.kind === 'word');
  return {
    outcome,
    you,
    them,
    adjustments: resigned
      ? null
      : { you: result.adjustments[HUMAN_SEAT] ?? 0, them: result.adjustments[BOT_SEAT] ?? 0 },
    end: endReason(state),
    margin: Math.abs(you - them),
    bestWord: bestOf(words),
    terms: { you: termsOf(words, HUMAN_SEAT), bot: termsOf(words, BOT_SEAT) },
    botRack: resigned ? null : (view.finalRacks?.[BOT_SEAT] ?? ''),
  };
}
