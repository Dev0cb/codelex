/**
 * Rules registry (ADR-0014 §D1, §D2, §D4; API note §4.1.1): contents of every `RulesSet`, the pinned digests of
 * the frozen ones, and `resolveRules`, the one resolution step of every entry point.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pinned from '../../test/golden/rules-digests.json' with { type: 'json' };
import { ALLOW_DRAFT_RULES, type DraftOptIn } from '../draft.js';
import { getLayout, getLetterTable, RULES } from './constants.js';
import {
  isRulesVersion,
  resolveRules,
  RULES_VERSIONS,
  rulesDigest,
  rulesFor,
  rulesVersionError,
} from './registry.js';
import type { EngineRulesVersion } from '../types.js';

const V1_RULES = {
  rackSize: 7,
  minFirstMoveTiles: 2,
  minBagForExchange: 7,
  scorelessTurnsPerSeat: 3,
  fullStackTiles: 7,
  fullStackBonus: 50,
  termBonus: { novice: 0, intermediate: 4, advanced: 8, expert: 16 },
  chainStep: 5,
  chainCap: 5,
};

describe('registry contents (ADR-0014 §D1, §D2)', () => {
  it('registers versions 1 and 2, ascending; nothing else', () => {
    expect(RULES_VERSIONS).toEqual([1, 2]);
    expect(RULES_VERSIONS.map((v) => rulesFor(v).engineRulesVersion)).toEqual([1, 2]);
    for (const v of [1, 2]) expect(isRulesVersion(v)).toBe(true);
    for (const v of [0, 3, -1, 1.5, '1', null, undefined, [1], {}]) {
      expect(isRulesVersion(v)).toBe(false);
    }
    expect(() => rulesFor(3 as EngineRulesVersion)).toThrow(RangeError);
  });

  it('R-SCORE-003 R-BOARD-004: v1 is frozen GAME_RULES 0.3.1, classic-v1 / letters-v1, term bonus 0/4/8/16', () => {
    const v1 = rulesFor(1);
    expect(v1).toEqual({
      engineRulesVersion: 1,
      status: 'frozen',
      gameRules: '0.3.1',
      layouts: ['classic-v1'],
      letterTables: ['letters-v1'],
      rules: V1_RULES,
      candidates: [],
    });
    // Deprecated alias (ADR-0014 §D6): RULES is rulesFor(1).rules, the same object.
    expect(RULES).toBe(v1.rules);
  });

  it('R-SCORE-003: v2 is a draft with the two D3 term-bonus candidates; default tb-0-2-4-8; nothing else changes', () => {
    const v2 = rulesFor(2);
    expect(v2.status).toBe('draft');
    expect(v2.gameRules).toBe('0.4-draft');
    expect(v2.layouts).toEqual(['classic-v1', 'classic-v2']);
    expect(v2.letterTables).toEqual(['letters-v2']);
    expect(v2.candidates.map((c) => c.id)).toEqual(['tb-0-2-4-8', 'tb-0-3-6-12']);
    const bonus = (id: string): unknown => v2.candidates.find((c) => c.id === id)?.rules;
    expect(bonus('tb-0-3-6-12')).toEqual({
      ...V1_RULES,
      termBonus: { novice: 0, intermediate: 3, advanced: 6, expert: 12 },
    });
    expect(bonus('tb-0-2-4-8')).toEqual({
      ...V1_RULES,
      termBonus: { novice: 0, intermediate: 2, advanced: 4, expert: 8 },
    });
    expect(v2.rules).toBe(bonus('tb-0-2-4-8'));
  });

  it('every set lists ≥ 1 layout and letter table, ascending, all resolvable', () => {
    const ascending = (xs: readonly string[]): boolean =>
      xs.every((x, i) => i === 0 || (xs[i - 1] as string) < x);
    for (const v of RULES_VERSIONS) {
      const set = rulesFor(v);
      expect(set.layouts.length).toBeGreaterThan(0);
      expect(set.letterTables.length).toBeGreaterThan(0);
      expect(ascending(set.layouts) && ascending(set.letterTables), String(v)).toBe(true);
      for (const id of set.layouts) expect(getLayout(id).id).toBe(id);
      for (const id of set.letterTables) expect(getLetterTable(id).id).toBe(id);
      // A frozen set has no candidates; a draft's default rules are one of its candidates.
      if (set.status === 'frozen') expect(set.candidates).toEqual([]);
      else expect(set.candidates.some((c) => c.rules === set.rules)).toBe(true);
    }
  });

  it('is deeply frozen constant data (ADR-0013 §D4: no mutable module state)', () => {
    const frozenDeep = (value: unknown): boolean =>
      typeof value !== 'object' ||
      value === null ||
      (Object.isFrozen(value) && Object.values(value).every(frozenDeep));
    expect(Object.isFrozen(RULES_VERSIONS)).toBe(true);
    for (const v of RULES_VERSIONS) expect(frozenDeep(rulesFor(v)), String(v)).toBe(true);
  });
});

describe('classic-v2 and letters-v2 (R-BOARD-004 v2 draft, b2-response §6; T-4a, L7)', () => {
  it('R-BOARD-004: classic-v2 equals classic-v1 except the start square (7,7), which is plain', () => {
    const v1 = getLayout('classic-v1');
    const v2 = getLayout('classic-v2');
    expect(v2.size).toBe(15);
    expect(v2.start).toEqual({ row: 7, col: 7 });
    const start = 7 * 15 + 7;
    expect(v1.squares[start]).toBe('DW');
    expect(v2.squares[start]).toBe('plain');
    const differences = v1.squares.flatMap((k, i) => (v2.squares[i] === k ? [] : [i]));
    expect(differences).toEqual([start]);
    // GAME_RULES 0.4 §2.2 (draft): DW count 12, premium squares 60 of 225.
    expect(v2.squares.filter((k) => k === 'DW')).toHaveLength(12);
    expect(v2.squares.filter((k) => k !== 'plain')).toHaveLength(60);
  });

  it('R-BAG-001: letters-v2 equals the L7 derivation record (BALANCE.md, lexiconVersion e568477b5592a994)', () => {
    const v2 = getLetterTable('letters-v2');
    expect(v2.id).toBe('letters-v2');
    // prettier-ignore
    expect(v2.values).toEqual([1, 3, 2, 2, 1, 4, 3, 3, 1, 8, 4, 2, 2, 1, 1, 2, 10, 1, 1, 1, 2, 6, 5, 8, 5, 8]);
    // prettier-ignore
    expect(v2.counts).toEqual([8, 2, 5, 4, 10, 1, 2, 2, 6, 1, 2, 4, 3, 5, 7, 4, 1, 7, 9, 7, 3, 1, 1, 1, 1, 1]);
    expect(v2.blanks).toBe(2);
    expect(v2.blankValue).toBe(0);
  });

  it('R-BAG-001/R-BAG-002: letters-v2 keeps 98 lettered tiles + 2 blanks, values 1–10, one 10 (step 5c)', () => {
    const v2 = getLetterTable('letters-v2');
    expect(v2.counts.reduce((s, n) => s + n, 0) + v2.blanks).toBe(100);
    expect(v2.counts.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
    expect(v2.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 10)).toBe(true);
    expect(v2.values.filter((v) => v === 10)).toHaveLength(1);
    // P-BAG-001-c: E, A, I, O, N, R, S, T are worth 1. Step 5b: vowels A E I O U are worth at most 2.
    for (const l of ['E', 'A', 'I', 'O', 'N', 'R', 'S', 'T'])
      expect(v2.values[l.charCodeAt(0) - 65]).toBe(1);
    for (const i of [0, 4, 8, 14, 20]) expect(v2.values[i]).toBeLessThanOrEqual(2);
    // A draft table, distinct from the frozen v1 table.
    expect(v2.values).not.toEqual(getLetterTable('letters-v1').values);
  });
});

describe('rulesDigest (ADR-0014 §D1)', () => {
  it('every frozen version is pinned in test/golden/rules-digests.json, and only frozen versions are', () => {
    const digests: Readonly<Record<string, string>> = pinned.digests;
    const frozen = RULES_VERSIONS.filter((v) => rulesFor(v).status === 'frozen');
    expect(Object.keys(digests)).toEqual(frozen.map(String));
    for (const v of frozen) expect(rulesDigest(v), `v${String(v)}`).toBe(digests[String(v)]);
  });

  it('v1 digest is 32c2abd097ccdb78 (frozen); digests are 16 hex and differ per version', () => {
    expect(rulesDigest(1)).toBe('32c2abd097ccdb78');
    const all = RULES_VERSIONS.map(rulesDigest);
    for (const d of all) expect(d).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('resolveRules — the draft guard (ADR-0014 §D4)', () => {
  it('a frozen version resolves without any opt-in, to its rules', () => {
    expect(resolveRules(1, undefined)).toEqual({
      ok: true,
      value: { set: rulesFor(1), rules: rulesFor(1).rules },
    });
    expect(resolveRules(1, { optIn: ALLOW_DRAFT_RULES })).toMatchObject({ ok: true });
  });

  it('a draft without the token is refused with status draft; a structurally equal object is no token', () => {
    const refused = {
      ok: false,
      error: {
        kind: 'engine',
        code: 'RULES_VERSION_UNSUPPORTED',
        message: 'draft rules version without the opt-in',
        details: { actual: 2, supported: '1', status: 'draft' },
      },
    };
    expect(resolveRules(2, undefined)).toEqual(refused);
    const forged = Object.freeze({}) as DraftOptIn;
    expect(resolveRules(2, { optIn: forged })).toEqual(refused);
    expect(resolveRules(2, { optIn: forged, candidate: 'tb-0-3-6-12' })).toEqual(refused);
  });

  it('with the token: default rules, or the named candidate', () => {
    const v2 = rulesFor(2);
    expect(resolveRules(2, { optIn: ALLOW_DRAFT_RULES })).toEqual({
      ok: true,
      value: { set: v2, rules: v2.rules },
    });
    const pick = resolveRules(2, { optIn: ALLOW_DRAFT_RULES, candidate: 'tb-0-3-6-12' });
    expect(pick.ok && pick.value.rules.termBonus.expert).toBe(12);
  });

  it('an unknown candidate, or a candidate for a frozen version, is refused', () => {
    expect(resolveRules(2, { optIn: ALLOW_DRAFT_RULES, candidate: 'tb-0-4-8-16' })).toEqual({
      ok: false,
      error: {
        kind: 'engine',
        code: 'RULES_VERSION_UNSUPPORTED',
        message: 'unknown rules candidate',
        details: { actual: 2, supported: '1', status: 'draft', candidate: 'tb-0-4-8-16' },
      },
    });
    expect(resolveRules(1, { optIn: ALLOW_DRAFT_RULES, candidate: 'tb-0-2-4-8' })).toMatchObject({
      ok: false,
      error: { details: { actual: 1, status: 'frozen', candidate: 'tb-0-2-4-8' } },
    });
  });

  it('an unregistered value of any JSON type is reported without stringifying it', () => {
    const actual = (v: unknown): unknown => rulesVersionError(v).details.actual;
    expect(actual(3)).toBe(3);
    expect(actual('2')).toBe('2');
    expect(actual(Number.POSITIVE_INFINITY)).toBe('number');
    expect(actual({ toString: 1 })).toBe('object');
    expect(actual(undefined)).toBe('undefined');
    expect(resolveRules('2', { optIn: ALLOW_DRAFT_RULES })).toMatchObject({
      ok: false,
      error: { details: { actual: '2', supported: '1' } },
    });
  });
});

describe('one code path (ADR-0014 §D1, §D6)', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..');
  const shipped = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return shipped(path);
      return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path] : [];
    });
  const files = shipped(src).map((path) => ({
    path: relative(src, path).split('\\').join('/'),
    text: readFileSync(path, 'utf8'),
  }));

  it('RULES is unread inside src: only its definition and the deprecated re-export mention it', () => {
    const readers = files.filter((f) => /\bRULES\b(?!_)/.test(f.text)).map((f) => f.path);
    expect(readers.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'index.ts',
      'rules/constants.ts',
    ]);
  });

  it('ENGINE_RULES_VERSION is unread inside src: only its definition and the deprecated re-export', () => {
    const readers = files.filter((f) => f.text.includes('ENGINE_RULES_VERSION')).map((f) => f.path);
    expect(readers.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'index.ts',
      'version.ts',
    ]);
  });

  it('the draft token is exported by the ./draft entry only, never by the root entry', async () => {
    const root = await import('../index.js');
    const draft = await import('../draft.js');
    expect(Object.keys(draft)).toEqual(['ALLOW_DRAFT_RULES']);
    expect(Object.values(root)).not.toContain(ALLOW_DRAFT_RULES);
    expect(root).not.toHaveProperty('ALLOW_DRAFT_RULES');
  });
});
