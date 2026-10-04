import { describe, expect, it } from 'vitest';
import gcDet01 from '../../test/golden/replays/v1/gc-det-01.json' with { type: 'json' };
import gcDet01Log from '../../test/golden/replays/v1/gc-det-01.log.json' with { type: 'json' };
import gcDet01Lexicon from '../../test/golden/replays/v1/gc-det-01.lexicon.json' with { type: 'json' };
import { GC_DET_01_CTX, GC_DET_01_FORMS } from '../../test/support/gc-det-01-lexicon.js';
import type { SMALL_VERSION } from '../../test/support/small-lexicon.js';
import { CTX, config1v1, smallLexicon } from '../../test/support/small-lexicon.js';
import type { Action, StateHash } from '../types.js';
import { newActionLog, parseActionLog, replay, serializeActionLog, type ActionLog } from './log.js';

const PASSES: Action[] = [
  { seat: 0, type: 'PASS' },
  { seat: 1, type: 'PASS' },
];

/** A short valid log on the small lexicon: whoever moves first passes, then the other seat. */
function shortLog(): ActionLog {
  const log = newActionLog(config1v1());
  const first = replay(log, CTX);
  if (!first.ok) throw new Error('replay');
  const s = first.value.state.firstSeat;
  return {
    ...log,
    actions: [
      { seat: s, type: 'PASS' },
      { seat: 1 - s, type: 'PASS' },
    ],
  };
}

const code = (text: string): unknown => {
  const r = parseActionLog(text);
  return r.ok ? 'ok' : r.error.code === 'MALFORMED_LOG' ? r.error.details.path : r.error.code;
};

const edit = (fn: (doc: Record<string, unknown>) => void): string => {
  const doc = JSON.parse(serializeActionLog(shortLog())) as Record<string, unknown>;
  fn(doc);
  return JSON.stringify(doc);
};

describe('GC-DET-01 golden replay (ADR-0013 §D5; P-GLOBAL-02)', () => {
  it('replays the stored log to the stored final hash, first seat and result', () => {
    const parsed = parseActionLog(JSON.stringify(gcDet01Log));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(parsed.value.header.seed).toBe(gcDet01.seed);
    expect(parsed.value.actions).toHaveLength(gcDet01.actionCount);
    const r = replay(parsed.value, GC_DET_01_CTX);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.finalHash).toBe(gcDet01.finalStateHash);
    expect(r.value.state.firstSeat).toBe(gcDet01.firstSeat);
    expect(r.value.state.result).toEqual(gcDet01.result);
  });

  it('n6: replays on the frozen term list stored next to the golden, not on the harness vocabulary', () => {
    expect(GC_DET_01_FORMS).toHaveLength(gcDet01Lexicon.termCount);
    expect(new Set(GC_DET_01_FORMS).size).toBe(gcDet01Lexicon.termCount);
    expect(GC_DET_01_CTX.lexicon.version).toBe(gcDet01Lexicon.version);
    expect(GC_DET_01_CTX.lexicon.profile.definitionHash).toBe(
      gcDet01Lexicon.profile.definitionHash,
    );
  });

  it('serialises the stored log byte for byte (JCS)', () => {
    const parsed = parseActionLog(JSON.stringify(gcDet01Log));
    if (!parsed.ok) throw new Error('parse');
    expect(serializeActionLog(parsed.value)).toBe(JSON.stringify(gcDet01Log));
  });
});

describe('parseActionLog (ADR-0013 §D2, P-API-06)', () => {
  it('round-trips a log', () => {
    const log = shortLog();
    expect(parseActionLog(serializeActionLog(log))).toEqual({ ok: true, value: log });
  });

  it('checks logVersion, then engineRulesVersion, before the schema', () => {
    expect(code(edit((d) => ((d['logVersion'] = 2), (d['x'] = 1))))).toBe(
      'LOG_VERSION_UNSUPPORTED',
    );
    // n4: a non-numeric version is reported as -1, never NaN.
    expect(parseActionLog(edit((d) => (d['logVersion'] = '1')))).toMatchObject({
      error: { details: { logVersion: -1 } },
    });
    expect(parseActionLog(edit((d) => (d['logVersion'] = 1.5)))).toMatchObject({
      error: { details: { logVersion: -1 } },
    });
    expect(
      parseActionLog(
        edit((d) => ((d['header'] as Record<string, unknown>)['engineRulesVersion'] = 'x')),
      ),
    ).toMatchObject({ error: { details: { actual: 'x', supported: '1' } } });
    expect(
      code(
        edit(
          (d) => (
            ((d['header'] as Record<string, unknown>)['engineRulesVersion'] = 2),
            (d['x'] = 1)
          ),
        ),
      ),
    ).toBe('RULES_VERSION_UNSUPPORTED');
    expect(code(edit((d) => (d['header'] = 'x')))).toBe('RULES_VERSION_UNSUPPORTED');
  });

  it.each<[string, string]>([
    ['', '{'],
    ['', '[]'],
  ])('MALFORMED_LOG at the root (%s)', (path, text) => {
    expect(code(text)).toBe(path);
  });

  it.each<[string, (d: Record<string, unknown>) => void]>([
    ['extra', (d) => (d['extra'] = 1)],
    // n1: the first unknown key in code-unit order, whatever the document order.
    ['Zz', (d) => ((d['zz'] = 1), (d['Zz'] = 1), (d['z'] = 1))],
    ['header.seed', (d) => ((d['header'] as Record<string, unknown>)['seed'] = 'x')],
    ['actions', (d) => (d['actions'] = {})],
    ['actions[0]', (d) => ((d['actions'] as unknown[])[0] = { seat: 0, type: 'PASS', at: 1 })],
    [
      'actions[0]',
      (d) =>
        ((d['actions'] as unknown[])[0] = {
          seat: 0,
          type: 'EXCHANGE',
          tiles: ['B', 'A'], // not canonical (unsorted)
        }),
    ],
    ['actions[1]', (d) => ((d['actions'] as unknown[])[1] = { seat: 7, type: 'PASS' })],
    ['stateHashes', (d) => (d['stateHashes'] = ['0000000000000000'])],
    ['stateHashes', (d) => (d['stateHashes'] = ['0000000000000000', 'XYZ'])],
    ['final', (d) => (d['final'] = { stateHash: '0000000000000000', actionCount: 1 })],
    ['final', (d) => (d['final'] = { stateHash: 'x', actionCount: 2 })],
    ['final', (d) => (d['final'] = { stateHash: '0000000000000000', actionCount: 2, x: 1 })],
  ])('MALFORMED_LOG at %s', (path, fn) => {
    expect(code(edit(fn))).toBe(path);
  });
});

describe('replay (ADR-0013 §D2, P-API-07)', () => {
  it('records hashes and verifies them; a flipped hash pinpoints its index', () => {
    const log = shortLog();
    const recorded = replay(log, CTX, { recordHashes: true });
    if (!recorded.ok) throw new Error('replay');
    const hashes = recorded.value.stateHashes ?? [];
    expect(hashes).toHaveLength(2);
    expect(replay({ ...log, stateHashes: hashes }, CTX).ok).toBe(true);
    const flipped = [hashes[0], 'ffffffffffffffff'] as StateHash[];
    expect(replay({ ...log, stateHashes: flipped }, CTX)).toMatchObject({
      error: { code: 'HASH_MISMATCH', details: { index: 1, expected: 'ffffffffffffffff' } },
    });
    // A finished log (seat 0 resigns): its final checkpoint is verified.
    const finished: ActionLog = { ...log, actions: [...log.actions, { seat: 0, type: 'RESIGN' }] };
    const done = replay(finished, CTX);
    if (!done.ok) throw new Error('replay');
    expect(done.value.state.status).toBe('finished');
    expect(
      replay({ ...finished, final: { stateHash: done.value.finalHash, actionCount: 3 } }, CTX).ok,
    ).toBe(true);
    expect(
      replay(
        { ...finished, final: { stateHash: 'ffffffffffffffff' as StateHash, actionCount: 3 } },
        CTX,
      ),
    ).toMatchObject({ error: { code: 'HASH_MISMATCH', details: { index: 'final' } } });
    expect(replay(log, CTX)).not.toHaveProperty('value.stateHashes');
  });

  it('n5: a final checkpoint on an unfinished match is MALFORMED_LOG', () => {
    const log = shortLog();
    const r = replay(log, CTX);
    if (!r.ok) throw new Error('replay');
    expect(r.value.state.status).toBe('in_progress');
    expect(
      replay({ ...log, final: { stateHash: r.value.finalHash, actionCount: 2 } }, CTX),
    ).toMatchObject({ error: { code: 'MALFORMED_LOG', details: { path: 'final' } } });
  });

  it('ACTION_REJECTED names the index and the rejection', () => {
    const log = shortLog();
    const bad = { ...log, actions: [...log.actions, log.actions[1] as Action] };
    expect(replay(bad, CTX)).toMatchObject({
      error: {
        code: 'ACTION_REJECTED',
        details: { index: 2, rejection: { code: 'not_your_turn' } },
      },
    });
    expect(
      replay(
        { ...log, actions: PASSES.map((a) => ({ ...a, type: 'JUMP' }) as unknown as Action) },
        CTX,
      ),
    ).toMatchObject({
      error: { code: 'ACTION_REJECTED', details: { index: 0, rejection: { code: 'malformed' } } },
    });
  });

  it('P-API-09: LEXICON_MISMATCH before the first action; header errors map to replay codes', () => {
    const foreign = { lexicon: smallLexicon('9999999999999999' as typeof SMALL_VERSION) };
    expect(replay(shortLog(), foreign)).toMatchObject({
      error: {
        kind: 'replay',
        code: 'LEXICON_MISMATCH',
        details: { expected: '0123456789abcdef/global-ranked/fedcba9876543210' },
      },
    });
    const log = shortLog();
    // ADR-0014 §D6 / API note §20 Q3 item 1: the replay details are the engine details.
    expect(replay({ ...log, header: { ...log.header, engineRulesVersion: 2 } }, CTX)).toMatchObject(
      {
        error: {
          code: 'RULES_VERSION_UNSUPPORTED',
          details: { actual: 2, supported: '1', status: 'draft' },
        },
      },
    );
    expect(
      replay({ ...log, header: { ...log.header, engineRulesVersion: 3 as 1 } }, CTX),
    ).toMatchObject({
      error: { code: 'RULES_VERSION_UNSUPPORTED', details: { actual: 3, supported: '1' } },
    });
    expect(
      replay({ ...log, header: { ...log.header, engineRulesVersion: Number.NaN as 1 } }, CTX),
    ).toMatchObject({
      error: { code: 'RULES_VERSION_UNSUPPORTED', details: { actual: 'number', supported: '1' } },
    });
    expect(replay({ ...log, header: { ...log.header, profileId: '' } }, CTX)).toMatchObject({
      error: { code: 'MALFORMED_LOG', details: { path: 'header.profileId' } },
    });
  });
});
