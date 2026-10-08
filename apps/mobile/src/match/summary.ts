/**
 * The end-of-match summary (E-1.5 AC-10, design §5.6, D-15) as plain data. Scores, adjustments, the result and the
 * final racks are the engine's (`observe` of the finished state, R-SCORE-006/007, R-END-003); the best word and the
 * term chips are read from the move log, whose breakdowns are the engine's own. Nothing is recomputed here.
 * "New to you" compares the player's canonical terms with the on-device history (slice S3, `terms-seen.ts`).
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
  /** First played by the player on this device (the NEW tag, design §5.6); always false for the bot's chips. */
  readonly isNew: boolean;
  /**
   * The first inflection this side played (PODS for POD) when it never played the canonical form itself: the card's
   * "Played as" line (E-1.7 AC-12). Null otherwise.
   */
  readonly playedAs: string | null;
}

export interface BestWord {
  /** As played (blanks lowercase). */
  readonly form: string;
  readonly points: number;
  readonly seat: Seat;
  /** Canonical term of the main word, for its Knowledge Card (design §5.6 "Tap opens the canonical card"). */
  readonly termId: string;
  readonly canonicalForm: string;
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
  /** How many of the player's canonical terms are new to them; null without an on-device history. */
  readonly newToYou: number | null;
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
  const main = best?.breakdown.words.find((w) => w.main);
  return best === null || main === undefined
    ? null
    : {
        form: best.form,
        points: best.points,
        seat: best.seat,
        termId: main.termId,
        canonicalForm: main.canonicalForm,
      };
}

function termsOf(
  words: readonly WordEntry[],
  seat: Seat,
  fresh: ReadonlySet<string> | null,
): TermChip[] {
  const seen = new Map<string, TermChip>();
  for (const entry of words) {
    if (entry.seat !== seat) continue;
    for (const word of entry.breakdown.words) {
      const inflection = word.form === word.canonicalForm ? null : word.form;
      const chip = seen.get(word.termId);
      if (chip === undefined) {
        seen.set(word.termId, {
          termId: word.termId,
          form: word.canonicalForm,
          isNew: fresh?.has(word.termId) ?? false,
          playedAs: inflection,
        });
      } else if (chip.playedAs !== null && inflection === null) {
        // The canonical form was played too: no "Played as" line.
        seen.set(word.termId, { ...chip, playedAs: null });
      }
    }
  }
  return [...seen.values()];
}

/**
 * The summary of a finished match; null while it runs. `newToYou` = the player's terms the on-device history did
 * not hold before this match (null when there is no history: the count and the tags are hidden).
 */
export function summarize(
  model: MatchModel,
  newToYou: ReadonlySet<string> | null = null,
): MatchSummary | null {
  const { state } = model;
  const outcome = matchOutcome(state);
  const result = state.result;
  if (outcome === null || result === undefined) return null;
  const view = observe(state, HUMAN_SEAT);
  const you = view.seats[HUMAN_SEAT]?.score ?? 0;
  const them = view.seats[BOT_SEAT]?.score ?? 0;
  const resigned = result.end.reason === 'resign';
  const words = model.log.filter((e): e is WordEntry => e.kind === 'word');
  const yourTerms = termsOf(words, HUMAN_SEAT, newToYou);
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
    terms: { you: yourTerms, bot: termsOf(words, BOT_SEAT, null) },
    newToYou: newToYou === null ? null : yourTerms.filter((chip) => chip.isNew).length,
    botRack: resigned ? null : (view.finalRacks?.[BOT_SEAT] ?? ''),
  };
}
