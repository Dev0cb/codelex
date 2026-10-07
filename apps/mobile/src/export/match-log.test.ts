/**
 * "Send match log" envelope `exportFormat: 1` (AC-20, S6d contract; threat model TM-04; sprint 4 D1): strict
 * allowlist, no install id or timestamp, size-capped, and the exported log replays to its stored hash.
 */
import { parseActionLog, replay, type ActionLog, type StateHash } from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import fc from 'fast-check';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import type { MatchModel } from '../match/match-model';
import { playMatchConfig } from '../match/play-config';
import { loadBundledLexicon, scriptMatch, seedOf } from '../match/test-support';
import { utf8Length, type ExportApp } from './common.ts';
import {
  base64,
  decodeMatchLog,
  encodeMatchLog,
  encodeRawMatchLog,
  MATCH_LOG_EXPORT_MAX_BYTES,
  MATCH_LOG_FILE_NAME,
  MATCH_LOG_RAW_MAX_BYTES,
} from './match-log.ts';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

const APP: ExportApp = { version: '0.1.0', build: '42', platform: 'ios' };
const ALLOWED_TOP = ['app', 'divergence', 'exportFormat', 'kind', 'log', 'raw'];
const ALLOWED_LOG = ['actions', 'final', 'header', 'logVersion', 'stateHashes'];

let lexicon: LoadedLexicon;

beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

/** The action log of a scripted match of `n` actions on `seed` (what the journal stores, as one ActionLog). */
function logOf(seedNumber: number, n: number): ActionLog {
  const seed = seedOf(seedNumber);
  const { start, steps } = scriptMatch(seed, lexicon, n);
  const last: MatchModel = steps.at(-1)?.after ?? start;
  const replayed = replay(
    { logVersion: 1, header: playMatchConfig(seed, lexicon.index), actions: last.actions },
    { lexicon: lexicon.index },
    { recordHashes: true },
  );
  if (!replayed.ok) throw new Error(replayed.error.message);
  const log: ActionLog = {
    logVersion: 1,
    header: playMatchConfig(seed, lexicon.index),
    actions: last.actions,
    stateHashes: replayed.value.stateHashes ?? [],
  };
  return log;
}

describe('match log export (exportFormat 1, TM-04)', () => {
  it('uses a fixed file name with no date or id', () => {
    expect(MATCH_LOG_FILE_NAME).toBe('codelex-match-log.json');
  });

  it('round-trips a readable log that replays to its stored hash', () => {
    const log = logOf(3301, 12);
    const encoded = encodeMatchLog(APP, log, null);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    const decoded = decodeMatchLog(encoded.value);
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
    if (!('log' in decoded.value)) throw new Error('expected a readable log');
    const parsed = parseActionLog(JSON.stringify(decoded.value.log));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const again = replay(parsed.value, { lexicon: lexicon.index });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.finalHash).toBe(log.stateHashes?.at(-1));
  });

  it('carries a divergence when the log failed to replay', () => {
    const log = logOf(3302, 4);
    const divergence = {
      index: 2,
      expected: '0123456789abcdef' as StateHash,
      actual: 'fedcba9876543210' as StateHash,
    };
    const encoded = encodeMatchLog(APP, log, divergence);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    expect(JSON.parse(encoded.value)).toMatchObject({ divergence });
    for (const index of ['final', 'from'] as const) {
      expect(encodeMatchLog(APP, log, { ...divergence, index }).ok).toBe(true);
    }
    expect(encodeMatchLog(APP, log, { ...divergence, index: -1 }).ok).toBe(false);
  });

  it('property: random matches export only allowlisted keys, never an id or a timestamp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 16 }), (seed, n) => {
        const encoded = encodeMatchLog(APP, logOf(seed, n), null);
        if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
        const file = JSON.parse(encoded.value) as Record<string, unknown>;
        expect(Object.keys(file).every((k) => ALLOWED_TOP.includes(k))).toBe(true);
        expect(Object.keys(file['app'] as object).sort()).toEqual(['build', 'platform', 'version']);
        expect(Object.keys(file['log'] as object).every((k) => ALLOWED_LOG.includes(k))).toBe(true);
        // No UUID (install id, local_match_id) and no ISO timestamp anywhere in the file.
        expect(encoded.value).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        expect(encoded.value).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      }),
      { numRuns: 8 },
    );
  });

  it('rejects anything outside the allowlist', () => {
    const log = logOf(3303, 2);
    const ok = encodeMatchLog(APP, log, null);
    if (!ok.ok) throw new Error('encode failed');
    const file = JSON.parse(ok.value) as Record<string, unknown>;
    const bad: unknown[] = [
      { ...file, installId: '3f0c8a4e-9b1d-4c2a-8e6f-1a2b3c4d5e6f' },
      { ...file, exportedAt: '2026-10-07T09:30:00.000Z' },
      { ...file, app: { ...APP, deviceModel: 'iPhone SE' } },
      { ...file, log: { ...(file['log'] as object), local_match_id: 'x' } },
      { ...file, log: { ...(file['log'] as object), logVersion: 2 } },
      { ...file, log: 'not a log' },
      { ...file, raw: 'AAAA' },
      { ...file, exportFormat: 2 },
      { ...file, kind: 'codelex.playtest_data' },
    ];
    for (const candidate of bad) expect(decodeMatchLog(JSON.stringify(candidate)).ok).toBe(false);
  });

  it('decoder: deep nesting and prototype keys are INVALID results, never exceptions (TM-08)', () => {
    const depth = 150_000; // arrays: 2 bytes per level
    const objectDepth = 60_000; // objects: 6 bytes per level, under the cap
    const envelope = `"exportFormat":1,"kind":"codelex.match_log","app":${JSON.stringify(APP)}`;
    const deepLog = `{${envelope},"log":${'{"a":'.repeat(objectDepth)}1${'}'.repeat(objectDepth)}}`;
    const deepArray = `{${envelope},"log":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    for (const text of [deepLog, deepArray]) {
      expect(utf8Length(text)).toBeLessThanOrEqual(MATCH_LOG_EXPORT_MAX_BYTES);
      const decoded = decodeMatchLog(text);
      expect(decoded.ok).toBe(false);
      if (!decoded.ok) expect(decoded.error.code).toBe('INVALID');
    }
    const ok = encodeMatchLog(APP, logOf(3304, 2), null);
    if (!ok.ok) throw new Error('encode failed');
    // An own `__proto__` key as the first member of the top-level object, and inside the log.
    const polluted = `{"__proto__":{"admin":true},${ok.value.slice(1)}`;
    expect(decodeMatchLog(polluted).ok).toBe(false);
    const at = ok.value.indexOf('"log":{') + '"log":{'.length;
    const pollutedLog = `${ok.value.slice(0, at)}"__proto__":{"admin":true},${ok.value.slice(at)}`;
    expect(decodeMatchLog(pollutedLog).ok).toBe(false);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });

  it('exports an unreadable record file as base64, capped at the TM-02 log cap', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
    const encoded = encodeRawMatchLog(APP, bytes);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    expect(JSON.parse(encoded.value)).toEqual({
      exportFormat: 1,
      kind: 'codelex.match_log',
      app: APP,
      raw: Buffer.from(bytes).toString('base64'),
    });
    expect(decodeMatchLog(encoded.value).ok).toBe(true);
    const max = encodeRawMatchLog(APP, new Uint8Array(MATCH_LOG_RAW_MAX_BYTES).fill(255));
    if (!max.ok) throw new Error(JSON.stringify(max.error));
    expect(utf8Length(max.value)).toBeLessThanOrEqual(MATCH_LOG_EXPORT_MAX_BYTES);
    expect(encodeRawMatchLog(APP, new Uint8Array(MATCH_LOG_RAW_MAX_BYTES + 1))).toEqual({
      ok: false,
      error: {
        code: 'TOO_LARGE',
        bytes: MATCH_LOG_RAW_MAX_BYTES + 1,
        maxBytes: MATCH_LOG_RAW_MAX_BYTES,
      },
    });
    expect(
      decodeMatchLog(JSON.stringify({ ...JSON.parse(encoded.value), raw: 'not base64!' })).ok,
    ).toBe(false);
  });

  it('base64 matches Buffer for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(base64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      }),
    );
  });
});
