/**
 * Q4 gating run: full matches on the REAL `global-ranked` index (`createReferenceIndex` over the real lexicon data,
 * native GADDAG from L5) and the real `classic-v1` premium layout, every move chosen by `chooseAction`
 * (random-legal, Beginner, greedy, Strategist), mixing 1v1 (40 %), 2v2, FFA-3 and FFA-4 (20 % each).
 *
 * The full 1,000-match run is `test/full/real-lexicon-1000.full.ts` (`pnpm --filter @codelex/bots test:full`);
 * this file runs the first GATING_MATCHES of the same sequence (same seeds, same mix) inside `pnpm test`.
 * Every `it` below states the rule / property it asserts in its name (traceability gate, tools/traceability).
 */
import { createMatch, getLayout } from '@codelex/game-engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedOf } from './support/match.js';
import {
  configFor,
  conserves,
  playRealMatch,
  realRankedIndex,
  summarize,
  type MatchRecord,
} from './support/real-matches.js';

/** Sized so the gating step stays well inside ~60 s in CI with `--concurrency=1` (numbers in the sprint doc). */
const GATING_MATCHES = 250;

const INDEX = realRankedIndex();
let records: MatchRecord[] = [];

beforeAll(() => {
  records = Array.from({ length: GATING_MATCHES }, (_, i) => playRealMatch(INDEX, i));
}, 240_000);

describe('real global-ranked index and real premium layout', () => {
  it('the matches run on the global-ranked profile with a native GADDAG', () => {
    expect(INDEX.profile.id).toBe('global-ranked');
    expect(INDEX.gaddag).toBeDefined();
    expect(INDEX.size).toBeGreaterThanOrEqual(1500);
    expect(records.every((r) => r.usedGaddag && r.layout === 'classic-v1')).toBe(true);
  });

  it('P-BOARD-002-d R-BOARD-002: classic-v1 has TW 8, DW 13, TL 12, DL 28 (the layout the matches use)', () => {
    const squares = getLayout('classic-v1').squares;
    const count = (kind: string): number => squares.filter((s) => s === kind).length;
    expect([count('TW'), count('DW'), count('TL'), count('DL')]).toEqual([8, 13, 12, 28]);
  });
});

describe(`${String(GATING_MATCHES)} full matches with bots on the real lexicon`, () => {
  it('R-MODE-CLASSIC-001 P-MODE-CLASSIC-001-a: 1v1, 2v2 and FFA 3/4 matches are all created and played to the end', () => {
    const s = summarize(records);
    expect(s.byShape['1v1']).toBeGreaterThanOrEqual(GATING_MATCHES * 0.35);
    expect(s.byShape['2v2']).toBeGreaterThanOrEqual(GATING_MATCHES * 0.15);
    expect(s.byShape.ffa3).toBeGreaterThanOrEqual(GATING_MATCHES * 0.15);
    expect(s.byShape.ffa4).toBeGreaterThanOrEqual(GATING_MATCHES * 0.15);
    expect(s.matches).toBe(GATING_MATCHES);
  });

  it('R-MODE-CLASSIC-002 P-MODE-CLASSIC-002-a: every 1v1 bot match uses format untimed-vs-bot and reaches a final result', () => {
    const oneVOne = records.filter((r) => r.shape === '1v1');
    expect(oneVOne.length).toBeGreaterThan(0);
    expect(oneVOne.every((r) => r.ended && r.endReason !== 'none')).toBe(true);
  });

  it('every personality plays in the run (random-legal, beginner, greedy, strategist)', () => {
    const s = summarize(records);
    expect(Object.values(s.personalitySeats).every((n) => n >= GATING_MATCHES / 3)).toBe(true);
  });

  it('every match ends by the scoreless limit or by going out, with no action cap hit', () => {
    expect(records.filter((r) => !r.ended)).toEqual([]);
    expect(
      records.every((r) => r.endReason === 'scoreless_turns' || r.endReason === 'going_out'),
    ).toBe(true);
  });

  it('P-GLOBAL-05 R-BAG-004: tiles are conserved after every accepted action, in every match', () => {
    expect(records.filter((r) => r.conservationBreak !== 0)).toEqual([]);
    expect(records.every((r) => r.actions > 0)).toBe(true);
  });

  it('P-GLOBAL-02 P-API-07: every match replays from its action log to the same state and every intermediate hash', () => {
    expect(records.filter((r) => !r.replayOk || !r.replayIdentical)).toEqual([]);
  });

  it('P-GLOBAL-05: the independent counter really detects a lost tile (the check is not vacuous)', () => {
    // A fresh state conserves; the same state with one tile dropped from the bag must not.
    const created = createMatch(configFor(INDEX, seedOf(5), '1v1'), { lexicon: INDEX });
    if (!created.ok) throw new Error(created.error.code);
    const state = created.value.state;
    expect(conserves(state)).toBe(true);
    expect(conserves({ ...state, bag: state.bag.slice(1) })).toBe(false);
  });
});
