/**
 * Review R1 M1: `-0` is a safe integer but outside the JCS subset (ADR-0013 §D3), so an accepted `-0` would make
 * `stateHash`, `serializeState`, `serializeActionLog` and `replay` throw later. Every trust boundary rejects it:
 * `parseAction` (and so `apply`, `evaluateMove`, `previewScore`, `parseActionLog`), `createMatch`, `parseState`.
 * These properties feed `-0` into every numeric field of actions, configs, states and logs.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playSteps, seedOf, SIM_CTX } from '../test/support/play.js';
import { parseAction } from './actions/parse.js';
import { canonicalJson } from './hash/jcs.js';
import { apply } from './match/apply.js';
import { createMatch } from './match/create.js';
import { evaluateMove, observe, previewScore } from './match/observe.js';
import {
  newActionLog,
  parseActionLog,
  replay,
  serializeActionLog,
  type ActionLog,
} from './replay/log.js';
import { parseState, serializeState, stateHash } from './state/state.js';
import type { Action, MatchConfig, PlaceWordAction } from './types.js';

type Path = readonly (string | number)[];
const SENTINEL = '__NEGATIVE_ZERO__';

/** Paths of every number in a JSON-like tree. */
function numericPaths(value: unknown, path: Path = []): Path[] {
  if (typeof value === 'number') return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => numericPaths(v, [...path, i]));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => numericPaths(v, [...path, k]));
  }
  return [];
}

/** A deep copy of `value` with the number at `path` replaced by `replacement`. */
function setAt(value: unknown, path: Path, replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v, i) => (i === head ? setAt(v, rest, replacement) : v));
  }
  const record = value as Record<string, unknown>;
  return { ...record, [String(head)]: setAt(record[String(head)], rest, replacement) };
}

/** JSON text of `value` with `-0` at `path` (JSON.stringify writes -0 as 0, so a sentinel is swapped in). */
function textWithNegativeZero(value: unknown, path: Path): string {
  return JSON.stringify(setAt(value, path, SENTINEL)).replace(`"${SENTINEL}"`, '-0');
}

const isNegativeZeroIn = (text: string): boolean => /[:[,]-0[,\]}]/.test(text);

describe('M1: -0 is rejected at every trust boundary (ADR-0013 §D3)', () => {
  it('parseAction: -0 seat, row or col is malformed', () => {
    const fail = (input: unknown): unknown => {
      const r = parseAction(input, 2);
      return r.ok ? 'ok' : r.error.code === 'malformed' ? r.error.details : r.error.code;
    };
    expect(fail({ seat: -0, type: 'PASS' })).toEqual({
      violation: 'seat_out_of_range',
      field: 'seat',
    });
    expect(fail({ seat: 0, type: 'PLACE_WORD', tiles: [{ row: -0, col: 7, tile: 'A' }] })).toEqual({
      violation: 'bad_coordinate',
      field: 'tiles[0].row',
    });
    expect(fail({ seat: 0, type: 'PLACE_WORD', tiles: [{ row: 7, col: -0, tile: 'A' }] })).toEqual({
      violation: 'bad_coordinate',
      field: 'tiles[0].col',
    });
  });

  it('createMatch: -0 in teams or requireWinner is INVALID_CONFIG', () => {
    const base = playSteps(seedOf(1), 2, 0).config;
    const field = (config: unknown): unknown => {
      const r = createMatch(config as MatchConfig, SIM_CTX);
      return r.ok ? 'ok' : (r.error.details?.['field'] ?? r.error.code);
    };
    expect(field({ ...base, config: { ...base.config, requireWinner: -0 } })).toBe(
      'config.requireWinner',
    );
    expect(field({ ...base, config: { ...base.config, teams: [[-0], [1]] } })).toBe('config.teams');
  });

  it(
    'PBT: an action with -0 in any numeric field is rejected as malformed; nothing downstream throws',
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(fc.nat(400), fc.nat(60), (i, steps) => {
          const played = playSteps(seedOf(i), 2, steps);
          const s = played.states.at(-1);
          if (s === undefined || s.status === 'finished') return;
          // A legal action shape for the seat on turn: the harness's next move, else a placement at the start.
          const candidate: Action = {
            seat: s.seatOnTurn,
            type: 'PLACE_WORD',
            tiles: [
              { row: 7, col: 7, tile: 'A' },
              { row: 7, col: 8, tile: 'I' },
            ],
          };
          for (const action of [candidate, { seat: s.seatOnTurn, type: 'PASS' } as const]) {
            for (const path of numericPaths(action)) {
              const bad = setAt(action, path, -0) as Action;
              const r = apply(s, bad, SIM_CTX);
              expect(r.ok ? 'ok' : r.error.code).toBe('malformed');
              const log: ActionLog = {
                ...newActionLog(played.config),
                actions: [...played.actions, bad],
              };
              const replayed = replay(log, SIM_CTX);
              expect(replayed.ok ? 'ok' : replayed.error.code).toBe('ACTION_REJECTED');
              if (bad.type === 'PLACE_WORD') {
                const ev = evaluateMove(observe(s, s.seatOnTurn), bad, SIM_CTX);
                expect(ev.ok ? 'ok' : ev.error.code).toBe('malformed');
                expect(previewScore(observe(s, s.seatOnTurn), bad.tiles)).toBeNull();
              }
            }
          }
        }),
        { seed: 20261003, numRuns: 40 },
      );
    },
  );

  it(
    'PBT: a config with -0 in any numeric field never yields a state or log that cannot be hashed',
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(fc.nat(1000), fc.constantFrom(2, 3, 4), (i, seats) => {
          const config = playSteps(seedOf(i), seats, 0).config;
          for (const path of numericPaths(config)) {
            const bad = setAt(config, path, -0) as MatchConfig;
            const created = createMatch(bad, SIM_CTX);
            if (created.ok) expect(() => stateHash(created.value.state)).not.toThrow();
            expect(created.ok).toBe(false);
            // replay always returns a Result.
            const r = replay(newActionLog(bad), SIM_CTX);
            expect(r.ok).toBe(false);
            // The same -0 in a log text: parseActionLog rejects it or yields a hashable log.
            const text = textWithNegativeZero(newActionLog(config), ['header', ...path]);
            expect(isNegativeZeroIn(text)).toBe(true);
            const parsed = parseActionLog(text);
            if (parsed.ok) expect(() => serializeActionLog(parsed.value)).not.toThrow();
            expect(parsed.ok).toBe(false);
          }
        }),
        { seed: 31, numRuns: 60 },
      );
    },
  );

  it(
    'PBT: a state with -0 in any numeric field is rejected by parseState',
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(fc.nat(400), fc.nat(120), (i, steps) => {
          const played = playSteps(seedOf(i), 2 + (i % 3), steps);
          const s = played.states.at(-1);
          if (s === undefined) return;
          const doc: unknown = JSON.parse(serializeState(s));
          for (const path of numericPaths(doc)) {
            const r = parseState(textWithNegativeZero(doc, path));
            if (r.ok) {
              expect(() => serializeState(r.value)).not.toThrow();
              expect(() => stateHash(r.value)).not.toThrow();
            }
            expect(r.ok).toBe(false);
          }
        }),
        { seed: 47, numRuns: 25 },
      );
    },
  );

  it(
    'PBT: a log with -0 in any numeric field parses to a serialisable log or fails; replay always returns a Result',
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(fc.nat(400), fc.nat(30), (i, steps) => {
          const played = playSteps(seedOf(i), 2, steps);
          const base: ActionLog = { ...newActionLog(played.config), actions: played.actions };
          const recorded = replay(base, SIM_CTX, { recordHashes: true });
          if (!recorded.ok) throw new Error(recorded.error.code);
          const full: ActionLog = {
            ...base,
            stateHashes: recorded.value.stateHashes ?? [],
            ...(recorded.value.state.status === 'finished'
              ? {
                  final: {
                    stateHash: recorded.value.finalHash,
                    actionCount: played.actions.length,
                  },
                }
              : {}),
          };
          const doc: unknown = JSON.parse(serializeActionLog(full));
          for (const path of numericPaths(doc)) {
            const parsed = parseActionLog(textWithNegativeZero(doc, path));
            if (!parsed.ok) continue;
            // Accepted only where -0 cannot survive (e.g. final.actionCount is rebuilt from the actions).
            const text = serializeActionLog(parsed.value);
            expect(isNegativeZeroIn(text)).toBe(false);
            const r = replay(parsed.value, SIM_CTX);
            if (r.ok) expect(() => stateHash(r.value.state)).not.toThrow();
          }
          // In-memory logs (typed callers) with -0 anywhere: replay returns a Result, never throws.
          for (const path of numericPaths(full)) {
            const bad = setAt(full, path, -0) as ActionLog;
            let outcome: unknown;
            expect(() => (outcome = replay(bad, SIM_CTX))).not.toThrow();
            expect(outcome).toHaveProperty('ok');
          }
        }),
        { seed: 53, numRuns: 25 },
      );
    },
  );

  it('canonicalJson itself still rejects -0 (programmer error)', () => {
    expect(() => canonicalJson({ x: -0 })).toThrow(RangeError);
    const placed: PlaceWordAction = { seat: 0, type: 'PLACE_WORD', tiles: [] };
    expect(() => canonicalJson(placed)).not.toThrow();
  });
});
