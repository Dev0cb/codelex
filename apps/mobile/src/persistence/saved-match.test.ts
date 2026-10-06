/**
 * Sprint 3 row S3 acceptance: "process-kill resume test loses 0 committed moves" (E-1.5 AC-11, threat model TM-01).
 * A full scripted match vs the Beginner is persisted exactly as the app does it (`persistTransition`, `finishMatch`)
 * while the process is killed at every write boundary in turn, with nothing or a torn part of the write on disk. The
 * next start (`openSavedMatch`) must restore every committed move, never flag corruption, and the bot must play the
 * same deterministic move after a kill during its turn (R-CORE-005, F-7). Also D-3 retention and low storage.
 */
import { stateHash, type MatchConfig, type SeedHex } from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import type { MatchModel } from '../match/match-model';
import { BOT_SEAT } from '../match/play-config';
import {
  botDecision,
  loadBundledLexicon,
  scriptMatch,
  seedOf,
  type ScriptedStep,
} from '../match/test-support';
import { FILES, SNAPSHOT_EVERY } from './match-journal';
import { MemoryFs } from './memory-fs';
import {
  createPersistence,
  finishMatch,
  GUARD_FILE,
  MAX_UNCLEAN_RESUMES,
  openSavedMatch,
  persistTransition,
  playedTermIds,
  snapshotOnBackground,
} from './saved-match';
import { TERMS_FILE } from './terms-seen';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
let ctx: { readonly lexicon: LoadedLexicon['index'] };
let start: MatchModel;
let steps: readonly ScriptedStep[];

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  ctx = { lexicon: lexicon.index };
  ({ start, steps } = scriptMatch(seedOf(3401), lexicon));
});

const headerOf = (model: MatchModel): MatchConfig => {
  const { state } = model;
  return {
    seed: state.seed,
    engineRulesVersion: state.engineRulesVersion,
    lexiconVersion: state.lexiconVersion,
    profileId: state.profileId,
    definitionHash: state.definitionHash,
    config: state.config,
  };
};

const modelAt = (k: number): MatchModel => (k === 0 ? start : (steps[k - 1]?.after ?? start));

/**
 * Plays the scripted match on `fs` as the app does, until the match is over or the process is killed. Returns how
 * many moves were committed (the write returned before the UI showed them).
 */
function playUntilKilled(fs: MemoryFs, background: boolean): number {
  const persistence = createPersistence(fs);
  let committed = 0;
  persistence.journal.start(headerOf(start));
  let before = start;
  for (const step of steps) {
    if (fs.killed) return committed;
    // 'saved' = the append returned: the app would show the move as committed (Q7).
    if (persistTransition(persistence.journal, before, step.after) === 'saved') committed += 1;
    if (background) snapshotOnBackground(persistence.journal, step.after.state);
    before = step.after;
  }
  if (!fs.killed) finishMatch(persistence, before);
  return committed;
}

function boundariesOfFullRun(background: boolean): number {
  const fs = new MemoryFs();
  playUntilKilled(fs, background);
  return fs.boundaries;
}

describe('process-kill resume (sprint 3 S3 acceptance, AC-11, TM-01)', () => {
  it('scripts a full match that crosses several snapshots and ends', () => {
    expect(steps.length).toBeGreaterThan(3 * SNAPSHOT_EVERY);
    expect(steps.at(-1)?.after.state.status).toBe('finished');
  });

  it.each([
    ['nothing of the write on disk', 0, false],
    ['a torn write (5 bytes on disk)', 5, false],
    ['a torn write, with a snapshot on every app_backgrounded', 11, true],
  ])(
    'loses 0 committed moves when killed at any write boundary: %s',
    (_name, tornBytes, background) => {
      const total = boundariesOfFullRun(background);
      const nextBotMove = new Map<number, unknown>();
      let resumed = 0;
      for (let killAt = 0; killAt < total; killAt += 1) {
        const fs = new MemoryFs({ killAt, tornBytes });
        const committed = playUntilKilled(fs, background);
        expect(fs.killed).toBe(true);

        const next = fs.reboot();
        const saved = openSavedMatch(createPersistence(next), ctx);
        if (saved.kind === 'none') {
          // Either nothing was committed, or the match was over and only its rotation was cut short.
          const over = committed === steps.length;
          expect(committed === 0 || over).toBe(true);
          if (over) expect(next.files.has(FILES.last)).toBe(true);
          continue;
        }
        expect(saved.kind).toBe('resumable');
        if (saved.kind !== 'resumable') continue;
        resumed += 1;
        const n = saved.model.actions.length;
        // Every committed move is back; at most the move being written when the process died is there too.
        expect(n).toBeGreaterThanOrEqual(committed);
        expect(n).toBeLessThanOrEqual(committed + 1);
        const reference = modelAt(n);
        expect(saved.model.actions).toEqual(reference.actions);
        expect(saved.model.state).toEqual(reference.state);
        expect(stateHash(saved.model.state)).toBe(stateHash(reference.state));
        expect(saved.model.log).toEqual(reference.log);
        // Killed while the bot was on turn: it re-derives the same stream and plays the same move.
        if (saved.model.state.seatOnTurn === BOT_SEAT && n < steps.length) {
          if (!nextBotMove.has(n)) {
            const decided = botDecision(saved.model.state, lexicon);
            nextBotMove.set(n, decided.ok ? decided.value.action : null);
          }
          expect(nextBotMove.get(n)).toEqual(steps[n]?.after.actions[n]);
        }
        // The resumed match keeps being saved: one more move survives another restart.
        const after = steps[n]?.after;
        if (after !== undefined) {
          const persistence = createPersistence(next);
          expect(openSavedMatch(persistence, ctx).kind).toBe('resumable');
          expect(persistTransition(persistence.journal, saved.model, after)).toBe('saved');
          const again = openSavedMatch(createPersistence(next.reboot()), ctx);
          expect(again.kind === 'resumable' ? again.model.state : null).toEqual(
            after.state.status === 'finished' ? null : after.state,
          );
        }
      }
      // Not vacuous: most kills land mid-match, and several during the bot's turn.
      expect(resumed).toBeGreaterThan(total / 2);
      expect(nextBotMove.size).toBeGreaterThan(5);
      expect([...nextBotMove.values()].every((a) => a !== null)).toBe(true);
    },
    300_000,
  );
});

describe('retention, history and the resume guard (TM-01 D-3, TM-02 D-1, AC-10)', () => {
  it('keeps at most the in-progress match and the last finished one after several matches', () => {
    const fs = new MemoryFs();
    const persistence = createPersistence(fs);
    const seeds: SeedHex[] = [seedOf(3402), seedOf(3403), seedOf(3404)];
    for (const seed of seeds) {
      const game = scriptMatch(seed, lexicon);
      persistence.journal.start(headerOf(game.start));
      let before = game.start;
      for (const step of game.steps) {
        expect(persistTransition(persistence.journal, before, step.after)).toBe('saved');
        before = step.after;
      }
      finishMatch(persistence, before);
    }
    const second = scriptMatch(seedOf(3405), lexicon, 4);
    persistence.journal.start(headerOf(second.start));
    let before = second.start;
    for (const step of second.steps) {
      persistTransition(persistence.journal, before, step.after);
      before = step.after;
    }
    const logs = [...fs.files.keys()].filter((name) => name.endsWith('.log'));
    expect(logs.sort()).toEqual([FILES.log, FILES.last].sort());
    expect([...fs.files.keys()].every((n) => !n.endsWith('.tmp'))).toBe(true);
  });

  it('records the terms the player played, and reports only the new ones', () => {
    const fs = new MemoryFs();
    const persistence = createPersistence(fs);
    const finished = steps.at(-1)?.after;
    if (finished === undefined) throw new Error('no match');
    persistence.journal.start(headerOf(start));
    const played = playedTermIds(finished);
    expect(played.length).toBeGreaterThan(0);
    expect([...finishMatch(persistence, finished)].sort()).toEqual([...played].sort());
    expect(fs.files.has(TERMS_FILE)).toBe(true);
    persistence.journal.start(headerOf(start));
    expect(finishMatch(persistence, finished).size).toBe(0);
    expect(persistence.terms.read()).toEqual(new Set(played));
  });

  it('shows the corrupt card instead of a third resume after two unclean exits', () => {
    const fs = new MemoryFs();
    const persistence = createPersistence(fs);
    persistence.journal.start(headerOf(start));
    persistTransition(persistence.journal, start, modelAt(1));
    // Two starts that died during resume left the counter at 2.
    persistence.store.replace(GUARD_FILE, [String(MAX_UNCLEAN_RESUMES)]);
    expect(openSavedMatch(createPersistence(fs.reboot()), ctx)).toEqual({
      kind: 'state_corrupt',
      divergence: null,
    });
    // The counter is cleared, so the player is not stuck: a clean start resumes again.
    const after = fs.reboot();
    after.files.delete(GUARD_FILE);
    expect(openSavedMatch(createPersistence(after), ctx).kind).toBe('resumable');
  });

  it('counts a resume that never returned', () => {
    const fs = new MemoryFs();
    const persistence = createPersistence(fs);
    persistence.journal.start(headerOf(start));
    persistTransition(persistence.journal, start, modelAt(1));
    // Killed right after the guard was written (boundaries: write tmp, delete, rename).
    const dying = fs.reboot({ killAt: 3 });
    expect(openSavedMatch(createPersistence(dying), ctx).kind).toBe('state_corrupt');
    const next = dying.reboot();
    expect(next.files.has(GUARD_FILE)).toBe(true);
    expect(openSavedMatch(createPersistence(next), ctx).kind).toBe('resumable');
    expect(next.files.has(GUARD_FILE)).toBe(false);
  });

  it('keeps playing from memory on a full disk, then rewrites the log once a write succeeds', () => {
    const fs = new MemoryFs();
    const persistence = createPersistence(fs);
    persistence.journal.start(headerOf(start));
    let before = start;
    for (let k = 1; k <= 6; k += 1) {
      const after = modelAt(k);
      fs.fullAfter = k === 3 || k === 4 ? 6 : null;
      const outcome = persistTransition(persistence.journal, before, after);
      expect(outcome).toBe(k === 3 || k === 4 ? 'failed' : 'saved');
      before = after;
    }
    const saved = openSavedMatch(createPersistence(fs.reboot()), ctx);
    expect(saved.kind === 'resumable' ? saved.model.state : null).toEqual(modelAt(6).state);
  });

  it('reports no change when no action was accepted', () => {
    const persistence = createPersistence(new MemoryFs());
    expect(persistTransition(persistence.journal, start, start)).toBe('unchanged');
  });
});
