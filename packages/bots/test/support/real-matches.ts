/**
 * Q4 harness: full matches on the REAL `global-ranked` index (`createReferenceIndex` over the real lexicon data,
 * native GADDAG from L5) and the real premium layout (`classic-v1`), with every move chosen by `chooseAction`.
 * Used by the gating run (`real-lexicon-matches.test.ts`, N matches) and the full 1,000-match run
 * (`test/full/real-lexicon-1000.full.ts`, `pnpm --filter @codelex/bots test:full`).
 *
 * Independence: tile conservation is counted here from the letter table (not with the engine's own counter), and
 * the replay is compared with hashes taken while playing (not only with the replay's own output).
 *
 * Determinism: the mix of formats and personalities is a pure function of the match index; seeds come from
 * `seedOf`. No clock, no entropy.
 */
import {
  apply,
  createMatch,
  getLayout,
  getLetterTable,
  observe,
  replay,
  stateHash,
  newActionLog,
  type Action,
  type MatchConfig,
  type MatchState,
  type SeedHex,
} from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { chooseAction } from '../../src/index.js';
import type { BotPersonalityId } from '../../src/index.js';
import { realIndex } from './lexicons.js';
import { botRng, contextFor, seedOf } from './match.js';

export type Shape = '1v1' | '2v2' | 'ffa3' | 'ffa4';

/** 1v1 40 %, 2v2 20 %, FFA-3 20 %, FFA-4 20 % (more multi-seat matches than the E4 run's 10 %). */
const SHAPES: readonly Shape[] = [
  '1v1',
  '2v2',
  'ffa3',
  'ffa4',
  '1v1',
  '2v2',
  'ffa3',
  'ffa4',
  '1v1',
  '1v1',
];

const PERSONALITY_IDS: readonly BotPersonalityId[] = ['random-legal', 'beginner', 'greedy'];

/** The real lexicon through `createReferenceIndex`, with L5's native GADDAG (asserted by the caller). */
export function realRankedIndex(): LexiconIndex {
  return realIndex();
}

export function shapeOf(i: number): Shape {
  return SHAPES[i % SHAPES.length] ?? '1v1';
}

export function seatsOf(shape: Shape): number {
  return shape === '1v1' ? 2 : shape === 'ffa3' ? 3 : 4;
}

/** Personality per seat: a pure function of the match index, covering every personality in every shape. */
export function personalitiesFor(i: number, seats: number): BotPersonalityId[] {
  return Array.from(
    { length: seats },
    (_, seat) => PERSONALITY_IDS[(Math.floor(i / SHAPES.length) + seat * 2 + i) % 3] ?? 'greedy',
  );
}

export function configFor(lexicon: LexiconIndex, seed: SeedHex, shape: Shape): MatchConfig {
  const seats = seatsOf(shape);
  const teams =
    shape === '2v2'
      ? [
          [0, 2],
          [1, 3],
        ]
      : Array.from({ length: seats }, (_, s) => [s]);
  return {
    seed,
    engineRulesVersion: 1,
    lexiconVersion: lexicon.version,
    profileId: lexicon.profile.id,
    definitionHash: lexicon.profile.definitionHash,
    config: {
      mode: 'classic',
      format: shape === '1v1' ? 'untimed-vs-bot' : 'untimed',
      seats,
      teams,
      layout: 'classic-v1',
      letters: 'letters-v1',
      requireWinner: 0,
    },
  };
}

/** Multiset of the initial bag from the letter table: 26 letter slots then blanks. */
function initialCounts(): number[] {
  const table = getLetterTable('letters-v1');
  return [...Array.from({ length: 26 }, (_, i) => table.counts[i] ?? 0), table.blanks];
}

const INITIAL = initialCounts();
const A = 'A'.charCodeAt(0);

/** Counts board + racks + bag by slot (designated blanks `a`-`z` and `?` count as blanks). Independent counter. */
export function tileCounts(state: MatchState): number[] {
  const counts = new Array<number>(27).fill(0);
  const add = (tiles: string): void => {
    for (const tile of tiles) {
      if (tile === '.') continue;
      const code = tile.charCodeAt(0);
      const slot = code >= A && code < A + 26 ? code - A : 26;
      counts[slot] = (counts[slot] ?? 0) + 1;
    }
  };
  add(state.bag);
  for (const seat of state.seats) add(seat.rack);
  for (const row of state.board) add(row);
  return counts;
}

export function conserves(state: MatchState): boolean {
  const counts = tileCounts(state);
  return INITIAL.every((n, slot) => counts[slot] === n);
}

export interface MatchRecord {
  readonly index: number;
  readonly shape: Shape;
  readonly seed: SeedHex;
  readonly personalities: readonly BotPersonalityId[];
  readonly ended: boolean;
  readonly endReason: string;
  /** Actions applied, and how many of them were each type. */
  readonly actions: number;
  readonly placed: number;
  /** First action (1-based) after which tiles were not conserved, or 0. */
  readonly conservationBreak: number;
  readonly finalHash: string;
  readonly replayOk: boolean;
  /** Replay reached the same final state, final hash and every intermediate hash. */
  readonly replayIdentical: boolean;
  /** Turn-order check: the seat on turn was always the seat whose bot decided. */
  readonly layout: string;
  readonly usedGaddag: boolean;
}

/** Hard stop (no match in the E4 run exceeds ~120 actions); a match that reaches it did not end. */
const ACTION_GUARD = 600;

export function playRealMatch(lexicon: LexiconIndex, index: number): MatchRecord {
  const shape = shapeOf(index);
  const seed = seedOf(index + 77_000);
  const seats = seatsOf(shape);
  const personalities = personalitiesFor(index, seats);
  const config = configFor(lexicon, seed, shape);
  const created = createMatch(config, { lexicon });
  if (!created.ok) throw new Error(`createMatch failed: ${created.error.code}`);
  let state = created.value.state;

  const actions: Action[] = [];
  const hashes: string[] = [];
  let placed = 0;
  let conservationBreak = conserves(state) ? 0 : 1;
  while (state.status === 'in_progress' && actions.length < ACTION_GUARD) {
    const seat = state.seatOnTurn;
    const personality = personalities[seat] ?? 'random-legal';
    const observation = observe(state, seat);
    const decided = chooseAction(
      observation,
      contextFor(lexicon, personality, botRng(seed, seat, observation.actionCount)),
    );
    if (!decided.ok) throw new Error(`chooseAction failed: ${decided.error.code}`);
    const applied = apply(state, decided.value.action, { lexicon });
    if (!applied.ok) {
      throw new Error(
        `apply rejected a bot action (${personality}, seed ${seed}, action ${String(actions.length)}): ${applied.error.code}`,
      );
    }
    state = applied.value.state;
    actions.push(applied.value.action);
    hashes.push(stateHash(state));
    if (applied.value.action.type === 'PLACE_WORD') placed += 1;
    if (conservationBreak === 0 && !conserves(state)) conservationBreak = actions.length;
  }

  const log = { ...newActionLog(config), actions };
  const replayed = replay(log, { lexicon }, { recordHashes: true });
  const replayOk = replayed.ok;
  const replayIdentical =
    replayed.ok &&
    stateHash(replayed.value.state) === stateHash(state) &&
    replayed.value.finalHash === stateHash(state) &&
    (replayed.value.stateHashes ?? []).length === hashes.length &&
    hashes.every((h, k) => h === replayed.value.stateHashes?.[k]);

  return {
    index,
    shape,
    seed,
    personalities,
    ended: state.status === 'finished',
    endReason: state.result?.end.reason ?? 'none',
    actions: actions.length,
    placed,
    conservationBreak,
    finalHash: stateHash(state),
    replayOk,
    replayIdentical,
    layout: getLayout(config.config.layout).id,
    usedGaddag: lexicon.gaddag !== undefined,
  };
}

export interface RunSummary {
  readonly matches: number;
  readonly byShape: Readonly<Record<Shape, number>>;
  readonly byEndReason: Readonly<Record<string, number>>;
  readonly personalitySeats: Readonly<Record<BotPersonalityId, number>>;
  readonly notEnded: number;
  readonly conservationBreaks: number;
  readonly replayMismatches: number;
  readonly totalActions: number;
  readonly placedWords: number;
  readonly minActions: number;
  readonly maxActions: number;
  /** Final state hashes in match order, joined with `,` (the caller hashes it into a digest). */
  readonly finalHashes: string;
}

export function summarize(records: readonly MatchRecord[]): RunSummary {
  const byShape: Record<Shape, number> = { '1v1': 0, '2v2': 0, ffa3: 0, ffa4: 0 };
  const byEndReason: Record<string, number> = {};
  const personalitySeats: Record<BotPersonalityId, number> = {
    'random-legal': 0,
    beginner: 0,
    greedy: 0,
  };
  let totalActions = 0;
  let placedWords = 0;
  let minActions = Number.MAX_SAFE_INTEGER;
  let maxActions = 0;
  for (const r of records) {
    byShape[r.shape] += 1;
    byEndReason[r.endReason] = (byEndReason[r.endReason] ?? 0) + 1;
    for (const p of r.personalities) personalitySeats[p] += 1;
    totalActions += r.actions;
    placedWords += r.placed;
    minActions = Math.min(minActions, r.actions);
    maxActions = Math.max(maxActions, r.actions);
  }
  return {
    matches: records.length,
    byShape,
    byEndReason: Object.fromEntries(
      Object.entries(byEndReason).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    personalitySeats,
    notEnded: records.filter((r) => !r.ended).length,
    conservationBreaks: records.filter((r) => r.conservationBreak !== 0).length,
    replayMismatches: records.filter((r) => !r.replayIdentical).length,
    totalActions,
    placedWords,
    minActions,
    maxActions,
    finalHashes: records.map((r) => r.finalHash).join(','),
  };
}
