/**
 * The zod-free on-device "Send match log" builder (slice S6d; threat model TM-04, I-2) equals the D1 contract
 * `export/match-log.ts`, which stays the Node-side reference (TM-08 import): same constants, same text byte for byte,
 * every file decodes with `decodeMatchLog`, and the exported log replays to its stored hash (AC-20). Allowlist: only
 * `current.log` or `last.log` is read, never another file of `codelex-data`, and the file holds only allowlisted keys.
 */
// `@jest/globals` first: the hoisted `jest.mock` factory of the engine below runs when the engine is imported.
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import {
  parseActionLog,
  replay,
  serializeActionLog,
  type ActionLog,
  type MatchConfig,
  type StateHash,
} from '@codelex/game-engine';
import type * as Engine from '@codelex/game-engine';
import fc from 'fast-check';

import { CONSENT_FILE } from '../analytics/consent';
import { INSTALL_ID_FILE } from '../analytics/install-id';
import { EXPORT_FORMAT, utf8Length, type ExportApp } from '../export/common.ts';
import {
  decodeMatchLog,
  encodeMatchLog,
  encodeRawMatchLog,
  MATCH_LOG_EXPORT_MAX_BYTES,
  MATCH_LOG_FILE_NAME as D1_FILE_NAME,
  MATCH_LOG_KIND,
  MATCH_LOG_RAW_MAX_BYTES,
} from '../export/match-log.ts';
import type { LoadedLexicon } from '../lexicon/load-lexicon';
import { playMatchConfig } from '../match/play-config';
import { loadBundledLexicon, scriptMatch, seedOf } from '../match/test-support';
import { DataStore } from '../persistence/data-store';
import { FILES, MatchJournal } from '../persistence/match-journal';
import { MemoryFs, ProcessKilled } from '../persistence/memory-fs';
import type { Divergence } from '../persistence/resume';
import {
  createPersistence,
  GUARD_FILE,
  MAX_UNCLEAN_RESUMES,
  openSavedMatch,
} from '../persistence/saved-match';
import {
  buildMatchLogFile,
  findMatchLog,
  MATCH_LOG_GUARD_FILE,
  MATCH_LOG_FILE_FORMAT,
  MATCH_LOG_FILE_KIND,
  MATCH_LOG_FILE_MAX_BYTES,
  MATCH_LOG_FILE_NAME,
  MATCH_LOG_FILE_RAW_MAX_BYTES,
  type MatchLogApp,
} from './match-log-file';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));
// The engine's real `replay`, spied, so a test can make it crash the app or check that it never runs (TM-04).
jest.mock('@codelex/game-engine', () => {
  const actual = jest.requireActual<typeof Engine>('@codelex/game-engine');
  return { ...actual, replay: jest.fn(actual.replay) };
});
const replayMock = jest.mocked(replay);

const APP: MatchLogApp = { version: '0.1.0', build: '42', platform: 'android' };
// Type-level equivalence with the D1 envelope `app`, both ways.
const asD1: ExportApp = APP;
const fromD1: MatchLogApp = asD1;

const ALLOWED_TOP = ['app', 'divergence', 'exportFormat', 'kind', 'log', 'raw'];
const ALLOWED_LOG = ['actions', 'header', 'logVersion', 'stateHashes'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

let lexicon: LoadedLexicon;
let ctx: { readonly lexicon: LoadedLexicon['index'] };

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
  ctx = { lexicon: lexicon.index };
});

interface Played {
  readonly config: MatchConfig;
  readonly log: ActionLog;
}

/**
 * Writes a scripted match of `n` actions through the app's journal (as `persistTransition` does), optionally with a
 * wrong hash at `tamperAt`, and finished (rotated to `last.log`) when `finish`. Returns what was written.
 */
function persist(
  store: DataStore,
  seedNumber: number,
  n: number,
  options: { readonly finish?: boolean; readonly tamperAt?: number } = {},
): Played {
  const seed = seedOf(seedNumber);
  const config = playMatchConfig(seed, lexicon.index);
  const { steps } = scriptMatch(seed, lexicon, n);
  const journal = new MatchJournal(store);
  journal.start(config);
  const actions = steps.at(-1)?.after.actions ?? [];
  const replayed = replay({ logVersion: 1, header: config, actions }, ctx, { recordHashes: true });
  if (!replayed.ok) throw new Error(replayed.error.message);
  const hashes: StateHash[] = (replayed.value.stateHashes ?? []).map((hash, i) =>
    i === options.tamperAt ? ('0123456789abcdef' as StateHash) : hash,
  );
  actions.forEach((action, i) => {
    const hash = hashes[i];
    if (hash === undefined || !journal.commit(action, hash)) throw new Error('commit failed');
  });
  if (options.finish === true) journal.finish();
  return { config, log: { logVersion: 1, header: config, actions, stateHashes: hashes } };
}

/** What D1 writes for `log` in the TM-04 form (`log` = `serializeActionLog` output). */
function d1Text(log: ActionLog, divergence: Divergence | null): string {
  const encoded = encodeMatchLog(APP, JSON.parse(serializeActionLog(log)) as ActionLog, divergence);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
  return encoded.value;
}

function build(store: DataStore, scope: 'current' | 'last'): string {
  const built = buildMatchLogFile(store, scope, APP, ctx);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

describe('on-device match log file (S6d) ≡ D1 contract', () => {
  it('mirrors the D1 constants', () => {
    expect(fromD1).toBe(APP);
    expect(MATCH_LOG_FILE_FORMAT).toBe(EXPORT_FORMAT);
    expect(MATCH_LOG_FILE_KIND).toBe(MATCH_LOG_KIND);
    expect(MATCH_LOG_FILE_NAME).toBe(D1_FILE_NAME);
    expect(MATCH_LOG_FILE_NAME).toBe('codelex-match-log.json');
    expect(MATCH_LOG_FILE_RAW_MAX_BYTES).toBe(MATCH_LOG_RAW_MAX_BYTES);
    expect(MATCH_LOG_FILE_MAX_BYTES).toBe(MATCH_LOG_EXPORT_MAX_BYTES);
  });

  it('scope: the in-progress match, else the last finished one, else none (design §5.8)', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    expect(findMatchLog(store)).toBeNull();
    persist(store, 4101, 6, { finish: true });
    expect(findMatchLog(store)).toBe('last');
    persist(store, 4102, 3);
    expect(findMatchLog(store)).toBe('current');
    expect(fs.reads).toEqual([]);
  });

  it('exports the in-progress match as D1 does, and it replays to its stored hash (AC-20)', () => {
    const store = new DataStore(new MemoryFs());
    const { log } = persist(store, 4103, 9);
    const text = build(store, 'current');
    expect(text).toBe(d1Text(log, null));
    const decoded = decodeMatchLog(text);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    if (!('log' in decoded.value)) throw new Error('expected a readable log');
    expect(decoded.value.log).toEqual(log);
    const parsed = parseActionLog(JSON.stringify(decoded.value.log));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const again = replay(parsed.value, ctx);
    expect(again.ok && again.value.finalHash).toBe(log.stateHashes?.at(-1));
  });

  it('exports the last finished match when none is in progress', () => {
    const store = new DataStore(new MemoryFs());
    const { log } = persist(store, 4104, Number.POSITIVE_INFINITY, { finish: true });
    expect(store.exists(FILES.log)).toBe(false);
    expect(build(store, 'last')).toBe(d1Text(log, null));
  });

  it('adds the first divergent checkpoint when a stored hash does not replay (TM-10)', () => {
    const store = new DataStore(new MemoryFs());
    const { log } = persist(store, 4105, 8, { tamperAt: 3 });
    const text = build(store, 'current');
    const replayed = replay(log, ctx, { verify: 'all' });
    if (replayed.ok || replayed.error.code !== 'HASH_MISMATCH')
      throw new Error('expected a mismatch');
    const divergence = replayed.error.details;
    expect(divergence.index).toBe(3);
    expect(text).toBe(d1Text(log, divergence));
    expect(decodeMatchLog(text).ok).toBe(true);
  });

  it('exports an unreadable record file as raw base64, as D1 does', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    persist(store, 4106, 5);
    const bytes = fs.files.get(FILES.log);
    if (bytes === undefined) throw new Error('no log');
    // Bad framing in the middle of the file: the record CRC no longer matches.
    const broken = bytes.slice();
    broken[10] = (broken[10] ?? 0) ^ 0xff;
    fs.files.set(FILES.log, broken);
    const expected = encodeRawMatchLog(APP, broken);
    if (!expected.ok) throw new Error('D1 refused');
    const text = build(store, 'current');
    expect(text).toBe(expected.value);
    expect(decodeMatchLog(text).ok).toBe(true);
  });

  it('exports a log of an unknown rules version as raw (the engine cannot read it)', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    const { config } = persist(store, 4107, 0);
    new MatchJournal(store).start({
      ...config,
      engineRulesVersion: 99 as MatchConfig['engineRulesVersion'],
    });
    const text = build(store, 'current');
    const raw = fs.files.get(FILES.log);
    if (raw === undefined) throw new Error('no log');
    expect(JSON.parse(text)).toEqual({
      exportFormat: 1,
      kind: 'codelex.match_log',
      app: APP,
      raw: Buffer.from(raw).toString('base64'),
    });
  });

  it('reads only the chosen match file, never the install id, consent, analytics or terms files', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    persist(store, 4108, 4, { finish: true });
    persist(store, 4109, 4);
    store.replace(INSTALL_ID_FILE, ['3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f']);
    store.replace(CONSENT_FILE, ['1']);
    fs.reads.length = 0;
    const text = build(store, 'current');
    build(store, 'last');
    expect([...new Set(fs.reads)].sort()).toEqual([FILES.last, FILES.log].sort());
    expect(text).not.toMatch(UUID);
  });

  it('property: random matches export only allowlisted keys, never an id, a path or a timestamp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 14 }), (seed, n) => {
        const store = new DataStore(new MemoryFs());
        const { log } = persist(store, seed, n);
        const text = build(store, 'current');
        expect(text).toBe(d1Text(log, null));
        const file = JSON.parse(text) as Record<string, unknown>;
        expect(Object.keys(file).every((k) => ALLOWED_TOP.includes(k))).toBe(true);
        expect(Object.keys(file['app'] as object)).toEqual(['version', 'build', 'platform']);
        expect(Object.keys(file['log'] as object).every((k) => ALLOWED_LOG.includes(k))).toBe(true);
        expect(text).not.toMatch(UUID);
        expect(text).not.toMatch(ISO_TIME);
        expect(text).not.toMatch(/file:|codelex-data|\/data\//);
      }),
      { numRuns: 6 },
    );
  });

  it('refuses an envelope outside the contract, a missing file and an oversized one', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    persist(store, 4110, 2);
    const bad: MatchLogApp[] = [
      { ...APP, version: '1' },
      { ...APP, build: 'x1' },
      { ...APP, platform: 'web' as MatchLogApp['platform'] },
    ];
    for (const app of bad) {
      expect(buildMatchLogFile(store, 'current', app, ctx)).toEqual({
        ok: false,
        error: { code: 'INVALID' },
      });
    }
    expect(buildMatchLogFile(store, 'last', APP, ctx)).toEqual({
      ok: false,
      error: { code: 'MISSING' },
    });
    fs.files.set(FILES.log, new Uint8Array(MATCH_LOG_FILE_RAW_MAX_BYTES + 1).fill(7));
    expect(buildMatchLogFile(store, 'current', APP, ctx)).toEqual({
      ok: false,
      error: { code: 'TOO_LARGE' },
    });
    fs.files.set(FILES.log, new Uint8Array(0));
    expect(buildMatchLogFile(store, 'current', APP, ctx)).toEqual({
      ok: false,
      error: { code: 'MISSING' },
    });
    // The largest raw file still fits the whole-file cap.
    fs.files.set(FILES.log, new Uint8Array(MATCH_LOG_FILE_RAW_MAX_BYTES).fill(255));
    const max = build(store, 'current');
    expect(utf8Length(max)).toBeLessThanOrEqual(MATCH_LOG_FILE_MAX_BYTES);
  });

  it('never throws: a failing disk is an INVALID result', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    persist(store, 4111, 2);
    fs.killed = true;
    expect(buildMatchLogFile(store, 'current', APP, ctx)).toEqual({
      ok: false,
      error: { code: 'INVALID' },
    });
  });
});

describe('Send match log never replays a log that may crash the app (TM-04, TM-02 D-1)', () => {
  it('a crash-guarded log (resume crashed twice) still exports, without divergence, and is never replayed', () => {
    const fs = new MemoryFs();
    const persistence = createPersistence(fs);
    const { log } = persist(persistence.store, 4120, 8, { tamperAt: 3 });
    persistence.store.replace(GUARD_FILE, [String(MAX_UNCLEAN_RESUMES)]);
    replayMock.mockClear();
    const saved = openSavedMatch(persistence, ctx);
    expect(saved).toEqual({ kind: 'state_corrupt', divergence: null });
    if (saved.kind !== 'state_corrupt') throw new Error('expected the corrupt card');
    const built = buildMatchLogFile(persistence.store, 'current', APP, ctx, { corrupt: saved });
    expect(built).toEqual({ ok: true, value: d1Text(log, null) });
    expect(replayMock).not.toHaveBeenCalled();
    expect(fs.files.has(MATCH_LOG_GUARD_FILE)).toBe(false);
  });

  it("a state_corrupt log takes the resume's divergence as is, without a second replay", () => {
    const persistence = createPersistence(new MemoryFs());
    // The last hash is wrong: the resume checks the final hash, then locates the divergence itself.
    const { log } = persist(persistence.store, 4121, 8, { tamperAt: 7 });
    const saved = openSavedMatch(persistence, ctx);
    if (saved.kind !== 'state_corrupt' || saved.divergence === null) {
      throw new Error('expected a divergence from the resume');
    }
    expect(saved.divergence.index).toBe(7);
    replayMock.mockClear();
    const built = buildMatchLogFile(persistence.store, 'current', APP, ctx, { corrupt: saved });
    expect(built).toEqual({ ok: true, value: d1Text(log, saved.divergence) });
    expect(replayMock).not.toHaveBeenCalled();
    // The resume's verdict is about current.log only: the last finished match is still checked.
    persist(persistence.store, 4122, 4, { finish: true });
    replayMock.mockClear();
    expect(buildMatchLogFile(persistence.store, 'last', APP, ctx, { corrupt: saved }).ok).toBe(
      true,
    );
    expect(replayMock).toHaveBeenCalledTimes(1);
  });

  it('a log whose replay crashed the app exports without divergence on every next attempt, never replayed', () => {
    const fs = new MemoryFs();
    const { log } = persist(new DataStore(fs), 4123, 8, { tamperAt: 3 });
    replayMock.mockClear();
    replayMock.mockImplementationOnce(() => {
      // The process dies inside the replay (native crash, out of memory, or killed while hung).
      fs.killed = true;
      throw new ProcessKilled();
    });
    buildMatchLogFile(new DataStore(fs), 'current', APP, ctx);
    expect(replayMock).toHaveBeenCalledTimes(1);
    const next = fs.reboot();
    expect(next.files.has(MATCH_LOG_GUARD_FILE)).toBe(true);
    replayMock.mockClear();
    const store = new DataStore(next);
    expect(build(store, 'current')).toBe(d1Text(log, null));
    expect(build(store, 'current')).toBe(d1Text(log, null));
    expect(decodeMatchLog(build(store, 'current')).ok).toBe(true);
    expect(replayMock).not.toHaveBeenCalled();
    // Another log (a new match) is replayed again: the guard names the log it protects.
    const other = persist(store, 4124, 6, { tamperAt: 2 });
    replayMock.mockClear();
    const file = JSON.parse(build(store, 'current')) as Record<string, unknown>;
    expect(replayMock).toHaveBeenCalledTimes(1);
    expect(file).toHaveProperty('divergence.index', 2);
    expect(file['log']).toEqual(JSON.parse(serializeActionLog(other.log)));
    expect(next.files.has(MATCH_LOG_GUARD_FILE)).toBe(false);
  });

  it('a log whose replay throws still exports, without divergence, and the guard is cleared', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    const { log } = persist(store, 4125, 8, { tamperAt: 3 });
    replayMock.mockImplementationOnce(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    expect(build(store, 'current')).toBe(d1Text(log, null));
    expect(fs.files.has(MATCH_LOG_GUARD_FILE)).toBe(false);
  });

  it('does not replay when the guard cannot be written (full disk), and still exports', () => {
    const fs = new MemoryFs();
    const store = new DataStore(fs);
    const { log } = persist(store, 4126, 5, { tamperAt: 1 });
    fs.fullAfter = 0;
    replayMock.mockClear();
    expect(build(store, 'current')).toBe(d1Text(log, null));
    expect(replayMock).not.toHaveBeenCalled();
  });
});
