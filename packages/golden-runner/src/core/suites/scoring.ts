/**
 * Suite `scoring/v1` (`scoring/v1/classic.json`, `scoring/v1/inflections.json`; RULE_PROPERTIES §3.1, §3.2), through
 * the public engine API only (CLAUDE.md §1.2: no rule logic here):
 *
 * - **Scoring cases** (`GC-CL-*`, `GC-INF-*`): `evaluateMove` on a fixture observation (the bots' scoring path,
 *   P-API-01: same breakdown as `apply`), built from a real `createMatch` observation on the G-LEX-SMALL stub with
 *   the case's board, rack and chain context, as the bots' crafted observations are.
 * - **End cases** (`GC-CL-E*`): a state with the case's scores and racks (`parseState`, so the engine checks it), then
 *   the ending action through `apply`: `RESIGN`, `PASS` until the scoreless limit, or a one-tile going-out move. The
 *   golden pins scores before the end adjustments, so the going-out move's own score (from its `WORD_PLACED`
 *   breakdown) is taken off before comparing.
 *
 * Booleans of the breakdown (`main`) are reported as 0/1 (the JCS subset has none).
 */
import {
  apply,
  createMatch,
  evaluateMove,
  getLetterTable,
  observe,
  parseState,
  type Action,
  type BoardTile,
  type LetterTableId,
  type MatchConfig,
  type MatchEvent,
  type MatchSetup,
  type MatchState,
  type Placement,
  type SeedHex,
} from '@codelex/game-engine';
import { canonicalJson } from '@codelex/game-engine/canonical';
import type { LexiconIndex } from '@codelex/lexicon/index';

import { bit, CaseError, lazy, unwrap, type CaseResult, type CaseSpec } from '../cases.js';
import { SCORING_CLASSIC_PATH, SCORING_INFLECTIONS_PATH, type GoldenCorpus } from '../corpus.js';
import { scoringLexicon } from '../fixtures/scoring-lexicon.js';

export const SCORING_V1_SUITE = 'scoring/v1';

interface GoldenTile {
  readonly r: number;
  readonly c: number;
  readonly letter: string;
  readonly blank?: boolean;
}

interface GoldenWord {
  readonly form: string;
  readonly main: boolean;
  readonly letterSum: number;
  readonly wordMult: number;
  readonly base: number;
  readonly termBonus: number;
}

interface ScoringCase {
  readonly id: string;
  readonly board: readonly GoldenTile[];
  readonly place: readonly GoldenTile[];
  readonly context?: { readonly prevMainTerm: string; readonly chainK: number };
  readonly expected: {
    readonly words: readonly GoldenWord[];
    readonly fullStack: number;
    readonly chain: number;
    readonly chainKAfter?: number;
    readonly total: number;
  };
}

interface EndCase {
  readonly id: string;
  readonly seats: number;
  readonly teams?: readonly (readonly number[])[];
  readonly endReason: string;
  readonly wentOut?: number | null;
  readonly resigned?: number;
  readonly scoresBefore: readonly number[] | { readonly teamA: number; readonly teamB: number };
  readonly racks: readonly (readonly string[])[];
  readonly expected: {
    readonly adjustments?: readonly number[];
    readonly adjustmentsPerSeat?: readonly number[];
    readonly final: readonly number[] | { readonly teamA: number; readonly teamB: number };
    readonly result: string;
  };
}

const BOARD_SIZE = 15;
const EMPTY_ROW = '.'.repeat(BOARD_SIZE);
const FIXTURE_SEED = '0000000000000001' as SeedHex;
/** Upper bound on the PASS loop of a scoreless end; the engine ends the match long before. */
const MAX_PASSES = 64;

/** Places of a two-team result as RULE_PROPERTIES §3.1 names it (team index = seat in 1v1). */
const PLACES: Readonly<Record<string, readonly number[]>> = {
  seat0_wins: [1, 2],
  seat1_wins: [2, 1],
  draw: [1, 1],
  teamA_wins: [1, 2],
  teamB_wins: [2, 1],
};

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedTiles(tiles: readonly string[]): string {
  return [...tiles].sort(byCodeUnit).join('');
}

function boardOf(
  tiles: readonly { readonly row: number; readonly col: number; readonly tile: string }[],
): string[] {
  const rows = new Array<string>(BOARD_SIZE).fill(EMPTY_ROW);
  for (const { row, col, tile } of tiles) {
    const line = rows[row] ?? EMPTY_ROW;
    rows[row] = line.slice(0, col) + tile + line.slice(col + 1);
  }
  return rows;
}

function boardTile(t: GoldenTile): BoardTile {
  return (t.blank === true ? t.letter.toLowerCase() : t.letter) as BoardTile;
}

function setupFor(
  seats: number,
  teams: readonly (readonly number[])[],
  letters: LetterTableId,
): MatchSetup {
  return {
    mode: 'classic',
    format: seats === 2 ? 'untimed-vs-bot' : 'untimed',
    seats,
    teams,
    layout: 'classic-v1',
    letters,
    requireWinner: 0,
  };
}

function configFor(lexicon: LexiconIndex, setup: MatchSetup): MatchConfig {
  return {
    seed: FIXTURE_SEED,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: setup,
  };
}

function startState(lexicon: LexiconIndex, setup: MatchSetup): MatchState {
  return unwrap(createMatch(configFor(lexicon, setup), { lexicon })).state;
}

function scoringCase(
  c: ScoringCase,
  lexicon: () => LexiconIndex,
  letters: LetterTableId,
): CaseResult {
  const lex = lexicon();
  const base = observe(startState(lex, setupFor(2, [[0], [1]], letters)), 0);
  const seats = base.seats.map((seat) =>
    seat.seat === 0
      ? { ...seat, chainK: c.context?.chainK ?? 0, lastMainForm: c.context?.prevMainTerm ?? '' }
      : seat,
  );
  const observation = {
    ...base,
    seatOnTurn: 0,
    board: boardOf(c.board.map((t) => ({ row: t.r, col: t.c, tile: boardTile(t) }))),
    rack: sortedTiles(c.place.map((t) => (t.blank === true ? '?' : t.letter))),
    seats,
  };
  const tiles: Placement[] = c.place.map((t) => ({ row: t.r, col: t.c, tile: boardTile(t) }));
  const evaluation = unwrap(
    evaluateMove(observation, { seat: 0, type: 'PLACE_WORD', tiles }, { lexicon: lex }),
  );
  const { breakdown } = evaluation;
  const words = (list: readonly GoldenWord[]): unknown[] =>
    list.map((w) => ({
      form: w.form,
      main: bit(w.main),
      letterSum: w.letterSum,
      wordMult: w.wordMult,
      base: w.base,
      termBonus: w.termBonus,
    }));
  const pinsChainK = c.expected.chainKAfter !== undefined;
  return {
    observed: {
      words: words(breakdown.words),
      fullStack: breakdown.fullStack,
      chain: breakdown.chain,
      ...(pinsChainK ? { chainKAfter: breakdown.chainKAfter } : {}),
      total: breakdown.total,
    },
    expected: {
      words: words(c.expected.words),
      fullStack: c.expected.fullStack,
      chain: c.expected.chain,
      ...(pinsChainK ? { chainKAfter: c.expected.chainKAfter } : {}),
      total: c.expected.total,
    },
  };
}

/** Splits a team total over its members (only the sum matters, RULE_PROPERTIES §3.1 GC-CL-E4). */
function splitScore(total: number, members: number): number[] {
  const share = Math.floor(total / members);
  return Array.from({ length: members }, (_, i) =>
    i === 0 ? total - share * (members - 1) : share,
  );
}

function scoresBefore(c: EndCase, teams: readonly (readonly number[])[]): number[] {
  const before = c.scoresBefore;
  if (Array.isArray(before)) return [...(before as readonly number[])];
  const totals = before as { readonly teamA: number; readonly teamB: number };
  const scores = new Array<number>(c.seats).fill(0);
  teams.forEach((team, t) => {
    const parts = splitScore(t === 0 ? totals.teamA : totals.teamB, team.length);
    team.forEach((seat, i) => (scores[seat] = parts[i] ?? 0));
  });
  return scores;
}

/** The going-out move: the goer holds one `I` and plays it after a lone `A`, forming AI (in G-LEX-SMALL). */
const GOER_TILE = 'I';
const ANCHOR = { row: 10, col: 7, tile: 'A' } as const;
const GOING_OUT_SQUARE = { row: 10, col: 8 } as const;

/**
 * Every other tile of the letter table on the board, row-major from (0, 0), far from the going-out squares (blanks
 * as a designated `e`), so the state conserves tiles (`parseState`) with an empty bag.
 */
function fillerTiles(
  letters: LetterTableId,
  held: string,
): { row: number; col: number; tile: string }[] {
  const table = getLetterTable(letters);
  const remaining = [...table.counts, table.blanks];
  for (const tile of held) {
    const slot = tile === '?' ? table.counts.length : tile.charCodeAt(0) - 65;
    remaining[slot] = (remaining[slot] ?? 0) - 1;
  }
  const out: { row: number; col: number; tile: string }[] = [];
  remaining.forEach((count, slot) => {
    for (let k = 0; k < count; k += 1) {
      const tile = slot === table.counts.length ? 'e' : String.fromCharCode(65 + slot);
      out.push({ row: Math.floor(out.length / BOARD_SIZE), col: out.length % BOARD_SIZE, tile });
    }
  });
  return out;
}

function endCase(c: EndCase, lexicon: () => LexiconIndex, letters: LetterTableId): CaseResult {
  const lex = lexicon();
  const teams = c.teams ?? Array.from({ length: c.seats }, (_, s) => [s]);
  const setup = setupFor(c.seats, teams, letters);
  const goer = c.endReason === 'going_out' ? (c.wentOut ?? 0) : undefined;
  const resigner = c.endReason === 'resign' ? (c.resigned ?? 0) : undefined;
  if (goer === undefined && resigner === undefined && c.endReason !== 'scoreless_turns') {
    throw new CaseError('CORPUS_MALFORMED');
  }
  const racks = c.racks.map((rack, seat) =>
    sortedTiles(seat === goer ? [...rack, GOER_TILE] : rack),
  );
  const held = racks.join('') + (goer === undefined ? '' : ANCHOR.tile);
  const board = [...fillerTiles(letters, held), ...(goer === undefined ? [] : [ANCHOR])];
  const before = scoresBefore(c, teams);
  const start = startState(lex, setup);
  const doc = {
    ...start,
    board: boardOf(board),
    bag: '',
    seatOnTurn: goer ?? resigner ?? start.seatOnTurn,
    seats: start.seats.map((seat, i) => ({ ...seat, rack: racks[i] ?? '', score: before[i] ?? 0 })),
  };
  let state = unwrap(parseState(canonicalJson(doc)));
  const events: MatchEvent[] = [];
  const act = (action: Action): void => {
    const applied = unwrap(apply(state, action, { lexicon: lex }));
    state = applied.state;
    events.push(...applied.events);
  };
  if (goer !== undefined) {
    act({ seat: goer, type: 'PLACE_WORD', tiles: [{ ...GOING_OUT_SQUARE, tile: GOER_TILE }] });
  } else if (resigner !== undefined) {
    act({ seat: resigner, type: 'RESIGN' });
  } else {
    for (let i = 0; i < MAX_PASSES && state.status === 'in_progress'; i += 1) {
      act({ seat: state.seatOnTurn, type: 'PASS' });
    }
  }
  const result = state.result;
  if (result === undefined) throw new CaseError('MATCH_NOT_FINISHED');
  const moveScore = events.reduce(
    (sum, event) => sum + (event.type === 'WORD_PLACED' ? event.breakdown.total : 0),
    0,
  );
  const goerTeam = teams.findIndex((team) => team.includes(goer ?? -1));
  const expectedFinal = c.expected.final;
  return {
    observed: {
      end: result.end,
      adjustments: result.adjustments,
      teamScores: result.teamScores.map((score, t) => (t === goerTeam ? score - moveScore : score)),
      places: result.places,
    },
    expected: {
      end:
        goer !== undefined
          ? { reason: 'going_out', seat: goer }
          : resigner !== undefined
            ? { reason: 'resign', seat: resigner }
            : { reason: 'scoreless_turns' },
      adjustments: c.expected.adjustments ?? c.expected.adjustmentsPerSeat,
      teamScores: Array.isArray(expectedFinal)
        ? expectedFinal
        : [
            (expectedFinal as { readonly teamA: number }).teamA,
            (expectedFinal as { readonly teamB: number }).teamB,
          ],
      places: PLACES[c.expected.result] ?? c.expected.result,
    },
  };
}

export function scoringCases(corpus: GoldenCorpus): CaseSpec[] {
  const lexicon = lazy(scoringLexicon);
  const classic = corpus[SCORING_CLASSIC_PATH];
  const inflections = corpus[SCORING_INFLECTIONS_PATH];
  /** v1 files are scored on `classic-v1` / `letters-v1` (the only pair this suite builds). */
  const letters = (file: { readonly layout: string; readonly letters: string }): LetterTableId => {
    if (file.layout !== 'classic-v1' || file.letters !== 'letters-v1') {
      throw new CaseError('CORPUS_MALFORMED');
    }
    return file.letters;
  };
  const scoring = (file: {
    readonly layout: string;
    readonly letters: string;
    readonly scoringCases: readonly unknown[];
  }): CaseSpec[] =>
    (file.scoringCases as readonly ScoringCase[]).map((c) => ({
      id: c.id,
      run: () => scoringCase(c, lexicon, letters(file)),
    }));
  return [
    ...scoring(classic),
    ...scoring(inflections),
    ...(classic.endCases as readonly EndCase[]).map((c) => ({
      id: c.id,
      run: () => endCase(c, lexicon, letters(classic)),
    })),
  ];
}
