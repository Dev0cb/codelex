/**
 * TM-02 resume hardening (threat model e-1.5-s1-persistence-match-log §7) on real scripted matches with the bundled
 * lexicon: a tampered, foreign or truncated snapshot resumes deep-equal to a full replay; bytes from anywhere never
 * make resume throw; draft and unknown rules versions show the version-mismatch card; a stored score is never
 * trusted.
 */
import {
  parseState,
  serializeState,
  stateHash,
  type MatchConfig,
  type MatchState,
  type SeedHex,
} from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import fc from 'fast-check';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import type { MatchModel } from '../match/match-model';
import { loadBundledLexicon, scriptMatch, seedOf } from '../match/test-support';
import { DataStore } from './data-store';
import {
  FILES,
  MatchJournal,
  readSnapshot,
  readStoredLog,
  storedLog,
  type StoredLog,
} from './match-journal';
import { MemoryFs } from './memory-fs';
import { restoreMatch } from './resume';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
let ctx: { readonly lexicon: LoadedLexicon['index'] };
let models: readonly MatchModel[];
let seed: SeedHex;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  ctx = { lexicon: lexicon.index };
  seed = seedOf(3301);
  const { start, steps } = scriptMatch(seed, lexicon, 24);
  models = [start, ...steps.map((s) => s.after)];
});

const at = (k: number): MatchModel => {
  const model = models[k];
  if (model === undefined) throw new Error(`no model at ${String(k)}`);
  return model;
};

/** The disk after `k` committed actions, with a snapshot of `snap` when given. */
function diskAfter(k: number, snap?: MatchState): MemoryFs {
  const fs = new MemoryFs();
  const store = new DataStore(fs);
  const journal = new MatchJournal(store);
  journal.start(configOf());
  for (let i = 1; i <= k; i += 1) {
    const model = at(i);
    const action = model.actions[i - 1];
    if (action === undefined) throw new Error('missing action');
    journal.commit(action, stateHash(model.state));
  }
  if (snap !== undefined) store.replace(FILES.snapshot, [serializeState(snap)]);
  return fs;
}

function configOf(): MatchConfig {
  const { state } = at(0);
  return {
    seed: state.seed,
    engineRulesVersion: state.engineRulesVersion,
    lexiconVersion: state.lexiconVersion,
    profileId: state.profileId,
    definitionHash: state.definitionHash,
    config: state.config,
  };
}

const restoreFrom = (fs: MemoryFs) => {
  const store = new DataStore(fs);
  return restoreMatch(readStoredLog(store), readSnapshot(store), ctx);
};

describe('restoreMatch (Q7, TM-02)', () => {
  it('restores every committed prefix exactly, from the log alone', () => {
    for (const k of [0, 1, 7, 24]) {
      const restored = restoreFrom(diskAfter(k));
      expect(restored.kind).toBe('restored');
      if (restored.kind !== 'restored') continue;
      expect(restored.path).toBe('full_replay');
      expect(restored.model.state).toEqual(at(k).state);
      expect(restored.model.log).toEqual(at(k).log);
      expect(restored.model.owners).toEqual(at(k).owners);
    }
  });

  it('uses a matching snapshot (restore path "snapshot")', () => {
    const restored = restoreFrom(diskAfter(24, at(20).state));
    expect(restored).toMatchObject({ kind: 'restored', path: 'snapshot' });
    if (restored.kind === 'restored') expect(restored.model.state).toEqual(at(24).state);
  });

  it('ignores a tampered, foreign or out-of-range snapshot and replays from the start', () => {
    const other = scriptMatch(seedOf(3302), lexicon, 20).steps.at(-1)?.after.state;
    if (other === undefined) throw new Error('no foreign state');
    const s20 = at(20).state;
    const tampered: MatchState[] = [
      // A stored score is never trusted: the replay recomputes it.
      { ...s20, seats: s20.seats.map((x, i) => (i === 0 ? { ...x, score: x.score + 50 } : x)) },
      other,
      at(24).state, // ahead of a 20-action log
    ];
    for (const snap of tampered) {
      const restored = restoreFrom(diskAfter(20, snap));
      expect(restored).toMatchObject({ kind: 'restored', path: 'full_replay' });
      if (restored.kind === 'restored') expect(restored.model.state).toEqual(s20);
    }
  });

  it('ignores a truncated snapshot', () => {
    const fs = diskAfter(20, at(20).state);
    const bytes = fs.files.get(FILES.snapshot);
    if (bytes === undefined) throw new Error('no snapshot');
    fs.files.set(FILES.snapshot, bytes.subarray(0, bytes.length - 40));
    expect(restoreFrom(fs)).toMatchObject({ kind: 'restored', path: 'full_replay' });
    // A snapshot that is valid JCS but not a state.
    const junk = diskAfter(20);
    new DataStore(junk).replace(FILES.snapshot, ['{"a":1}']);
    expect(restoreFrom(junk)).toMatchObject({ kind: 'restored', path: 'full_replay' });
  });

  it('shows the version-mismatch card for a draft or unknown rules version, or another lexicon', () => {
    const withHeader = (patch: Record<string, unknown>): StoredLog => {
      const stored = readStoredLog(new DataStore(diskAfter(3)));
      if (stored.kind !== 'ok') throw new Error('no log');
      const log = JSON.parse(stored.text) as { header: Record<string, unknown> };
      return { ...stored, text: JSON.stringify({ ...log, header: { ...log.header, ...patch } }) };
    };
    // 2 is the registry's draft entry: refused without the simulator's opt-in (ADR-0014 §D4); 99 is unknown.
    for (const engineRulesVersion of [2, 99]) {
      expect(restoreMatch(withHeader({ engineRulesVersion }), null, ctx)).toEqual({
        kind: 'version_mismatch',
      });
    }
    expect(restoreMatch(withHeader({ lexiconVersion: '0000000000000000' }), null, ctx)).toEqual({
      kind: 'version_mismatch',
    });
  });

  it('maps an edited move to state_corrupt with the first divergent checkpoint', () => {
    const stored = readStoredLog(new DataStore(diskAfter(10)));
    if (stored.kind !== 'ok') throw new Error('no log');
    const log = JSON.parse(stored.text) as { stateHashes: string[] };
    const hashes = log.stateHashes.map((h, i) => (i === 4 ? '0123456789abcdef' : h));
    const edited = { ...stored, text: JSON.stringify({ ...log, stateHashes: hashes }) };
    // The last hash is intact, so the fast path still restores; the edited middle checkpoint is not on it (Q7).
    expect(restoreMatch(edited, null, ctx).kind).toBe('restored');
    const lastBad = log.stateHashes.map((h, i) => (i === 9 ? '0123456789abcdef' : h));
    expect(
      restoreMatch(
        { ...stored, text: JSON.stringify({ ...log, stateHashes: lastBad }) },
        null,
        ctx,
      ),
    ).toEqual({
      kind: 'state_corrupt',
      divergence: { index: 9, expected: '0123456789abcdef', actual: stateHash(at(10).state) },
    });
  });

  it('maps a corrupt or unparsable log to state_corrupt and an absent one to none', () => {
    expect(restoreMatch({ kind: 'none' }, null, ctx)).toEqual({ kind: 'none' });
    expect(restoreMatch({ kind: 'corrupt' }, null, ctx)).toEqual({
      kind: 'state_corrupt',
      divergence: null,
    });
    expect(restoreMatch({ kind: 'ok', text: '{', droppedTail: false }, null, ctx)).toEqual({
      kind: 'state_corrupt',
      divergence: null,
    });
  });

  it('never throws on arbitrary log or snapshot bytes (fuzz, TM-02 D-1)', () => {
    const real = diskAfter(6, at(6).state);
    const logBytes = real.files.get(FILES.log) ?? new Uint8Array(0);
    const snapBytes = real.files.get(FILES.snapshot) ?? new Uint8Array(0);
    const mutate = (base: Uint8Array) =>
      fc
        .array(fc.tuple(fc.nat(base.length + 8), fc.integer({ min: 0, max: 255 })), {
          maxLength: 6,
        })
        .chain((edits) =>
          fc.nat(base.length).map((cut) => {
            const out = base.slice(0, Math.max(cut, 1));
            for (const [i, v] of edits) if (i < out.length) out[i] = v;
            return out;
          }),
        );
    fc.assert(
      fc.property(
        fc.oneof(mutate(logBytes), fc.uint8Array({ maxLength: 300 })),
        fc.oneof(mutate(snapBytes), fc.uint8Array({ maxLength: 300 })),
        (log, snap) => {
          const fs = new MemoryFs();
          fs.files.set(FILES.log, log);
          fs.files.set(FILES.snapshot, snap);
          const restored = restoreFrom(fs);
          expect(['none', 'restored', 'version_mismatch', 'state_corrupt']).toContain(
            restored.kind,
          );
        },
      ),
      { seed: 3303, numRuns: 150 },
    );
  }, 120_000);

  it('parses a snapshot only through parseState (a snapshot is a cache, never a source)', () => {
    const text = readSnapshot(new DataStore(diskAfter(10, at(10).state)));
    expect(text).not.toBeNull();
    expect(parseState(text ?? '').ok).toBe(true);
  });
});

describe('storedLog envelopes', () => {
  it('rejects records that are not { a, h } and headers that are not { logVersion, header }', () => {
    const ok = (records: string[]) => storedLog({ kind: 'ok', records, droppedTail: false }).kind;
    expect(ok([])).toBe('none');
    expect(ok(['[]'])).toBe('corrupt');
    expect(ok(['{"logVersion":1,"header":{}}', '{"a":1}'])).toBe('corrupt');
    expect(ok(['{"logVersion":1,"header":{}}', 'nope'])).toBe('corrupt');
    expect(ok(['{"logVersion":1,"header":{}}', '{"a":1,"h":"x"}'])).toBe('ok');
    expect(storedLog({ kind: 'too_large' }).kind).toBe('corrupt');
    expect(storedLog({ kind: 'missing' }).kind).toBe('none');
  });
});
