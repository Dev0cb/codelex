/**
 * ADR-0014 §D2, §D4: per-version config values and the draft guard at every entry point (`createMatch`,
 * `parseState`, `parseActionLog`, `replay`; also `apply` and `evaluateMove`, which resolve the same rules), plus
 * the v2 draft outcomes that differ from v1: the plain start (R-BOARD-004 v2) and the term-bonus candidates
 * (R-SCORE-003 v2).
 */
import { describe, expect, it } from 'vitest';
import { CTX, config1v1 } from '../../test/support/small-lexicon.js';
import { draftCtx } from '../../test/support/variants.js';
import { ALLOW_DRAFT_RULES } from '../draft.js';
import { newActionLog, parseActionLog, replay, serializeActionLog } from '../replay/log.js';
import { parseState, serializeState } from '../state/state.js';
import type {
  EngineContext,
  MatchConfig,
  MatchSetup,
  MatchState,
  Observation,
  Placement,
} from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';
import { evaluateMove, observe, previewScore } from './observe.js';

const DRAFT = draftCtx(undefined, CTX);
const OPT_IN = { draft: { optIn: ALLOW_DRAFT_RULES } };

function config(
  engineRulesVersion: 1 | 2,
  setup: Partial<Pick<MatchSetup, 'layout' | 'letters'>> = {},
): MatchConfig {
  const base = config1v1();
  return {
    ...base,
    engineRulesVersion,
    config: {
      ...base.config,
      layout: engineRulesVersion === 1 ? 'classic-v1' : 'classic-v2',
      letters: engineRulesVersion === 1 ? 'letters-v1' : 'letters-v2',
      ...setup,
    },
  };
}

function created(cfg: MatchConfig, ctx: EngineContext): MatchState {
  const r = createMatch(cfg, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.state;
}

const DRAFT_REFUSED = {
  code: 'RULES_VERSION_UNSUPPORTED',
  details: { actual: 2, supported: '1', status: 'draft' },
};

describe('per-version MatchSetup values (ADR-0014 §D2)', () => {
  it.each<[string, MatchConfig, EngineContext, string]>([
    ['v1 with classic-v2', config(1, { layout: 'classic-v2' }), CTX, 'config.layout'],
    ['v1 with letters-v2', config(1, { letters: 'letters-v2' }), CTX, 'config.letters'],
    ['v2 with letters-v1', config(2, { letters: 'letters-v1' }), DRAFT, 'config.letters'],
  ])('%s → INVALID_CONFIG', (_name, cfg, ctx, field) => {
    expect(createMatch(cfg, ctx)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONFIG', details: { field } },
    });
  });

  it('v2 (draft) accepts classic-v2 and classic-v1 with letters-v2', () => {
    for (const layout of ['classic-v2', 'classic-v1'] as const) {
      const s = created(config(2, { layout }), DRAFT);
      expect(s.engineRulesVersion).toBe(2);
      expect(s.config.layout).toBe(layout);
      expect(s.config.letters).toBe('letters-v2');
    }
  });

  it('the draft version check comes before the config check', () => {
    expect(createMatch({ ...config(2), seed: 'bad' as MatchConfig['seed'] }, CTX)).toMatchObject({
      ok: false,
      error: DRAFT_REFUSED,
    });
  });
});

describe('draft guard at every entry point (ADR-0014 §D4)', () => {
  const v2 = created(config(2), DRAFT);
  const seat = v2.seatOnTurn;

  it('createMatch refuses a draft without ctx.draft', () => {
    expect(createMatch(config(2), CTX)).toEqual({
      ok: false,
      error: {
        kind: 'engine',
        code: 'RULES_VERSION_UNSUPPORTED',
        message: 'draft rules version without the opt-in',
        details: { actual: 2, supported: '1', status: 'draft' },
      },
    });
    expect(createMatch(config(2), draftCtx('nope', CTX))).toMatchObject({
      ok: false,
      error: { code: 'RULES_VERSION_UNSUPPORTED', details: { candidate: 'nope' } },
    });
  });

  it('parseState refuses a draft state without options.draft; with it, round-trips (P-GLOBAL-04)', () => {
    const text = serializeState(v2);
    expect(parseState(text)).toMatchObject({ ok: false, error: DRAFT_REFUSED });
    expect(parseState(text, OPT_IN)).toEqual({ ok: true, value: v2 });
  });

  it('parseActionLog refuses a draft log without options.draft; with it, round-trips (P-API-06)', () => {
    const log = newActionLog(config(2));
    const text = serializeActionLog(log);
    expect(parseActionLog(text)).toMatchObject({
      ok: false,
      error: { kind: 'replay', ...DRAFT_REFUSED },
    });
    expect(parseActionLog(text, OPT_IN)).toEqual({ ok: true, value: log });
  });

  it('replay refuses a draft log without ctx.draft; with it, replays', () => {
    const log = { ...newActionLog(config(2)), actions: [{ seat, type: 'PASS' as const }] };
    expect(replay(log, CTX)).toMatchObject({
      ok: false,
      error: { kind: 'replay', ...DRAFT_REFUSED },
    });
    const r = replay(log, DRAFT);
    expect(r.ok && r.value.state.scorelessTurns).toBe(1);
  });

  it('apply and evaluateMove resolve the same rules: a draft state without ctx.draft is refused', () => {
    expect(apply(v2, { seat, type: 'PASS' }, CTX)).toMatchObject({
      ok: false,
      error: DRAFT_REFUSED,
    });
    expect(apply(v2, { seat, type: 'PASS' }, DRAFT).ok).toBe(true);
    const tiles: Placement[] = [
      { row: 7, col: 7, tile: 'a' },
      { row: 7, col: 8, tile: 'i' },
    ];
    const obs: Observation = { ...observe(v2, seat), rack: '??' };
    expect(evaluateMove(obs, { seat, type: 'PLACE_WORD', tiles }, CTX)).toMatchObject({
      ok: false,
      error: DRAFT_REFUSED,
    });
    expect(evaluateMove(obs, { seat, type: 'PLACE_WORD', tiles }, DRAFT).ok).toBe(true);
    // previewScore has no context: a draft needs options.draft, like parseState (review of E6).
    expect(previewScore(obs, tiles)).toBeNull();
    expect(previewScore(obs, tiles, OPT_IN)?.total).toBe(0);
    expect(previewScore({ ...obs, engineRulesVersion: 3 as 1 }, tiles, OPT_IN)).toBeNull();
  });
});

describe('no bypass through the tables: a version only runs with its own layout and letters (ADR-0014 §D2)', () => {
  const v1 = created(config(1), CTX);
  const seat = v1.seatOnTurn;
  const tiles: Placement[] = [
    { row: 7, col: 6, tile: 'P' },
    { row: 7, col: 7, tile: 'O' },
    { row: 7, col: 8, tile: 'D' },
  ];
  const place = { seat, type: 'PLACE_WORD' as const, tiles };

  it.each<[string, Partial<Pick<MatchSetup, 'layout' | 'letters'>>, string]>([
    ['v1 with the draft layout classic-v2', { layout: 'classic-v2' }, 'config.layout'],
    ['v1 with the draft letters-v2', { letters: 'letters-v2' }, 'config.letters'],
    ['v1 with both draft tables', { layout: 'classic-v2', letters: 'letters-v2' }, 'config.layout'],
  ])(
    '%s: apply, evaluateMove and previewScore refuse it, with or without the opt-in',
    (_name, tables, field) => {
      const forged: MatchState = { ...v1, config: { ...v1.config, ...tables } };
      const obs: Observation = { ...observe(forged, seat), rack: 'DOP' };
      const refused = {
        ok: false,
        error: { kind: 'engine', code: 'INVALID_CONFIG', details: { field } },
      };
      for (const ctx of [CTX, DRAFT]) {
        expect(apply(forged, { seat, type: 'PASS' }, ctx)).toMatchObject(refused);
        expect(evaluateMove(obs, place, ctx)).toMatchObject(refused);
      }
      expect(previewScore(obs, tiles)).toBeNull();
      expect(previewScore(obs, tiles, OPT_IN)).toBeNull();
      // The genuine v1 match still plays and previews.
      expect(evaluateMove({ ...observe(v1, seat), rack: 'DOP' }, place, CTX).ok).toBe(true);
      expect(previewScore({ ...observe(v1, seat), rack: 'DOP' }, tiles)?.total).toBe(12);
    },
  );

  it('a v2 state with v1 letters is refused even with the opt-in', () => {
    const v2 = created(config(2), DRAFT);
    const forged: MatchState = { ...v2, config: { ...v2.config, letters: 'letters-v1' } };
    expect(apply(forged, { seat: v2.seatOnTurn, type: 'PASS' }, DRAFT)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONFIG', details: { field: 'config.letters' } },
    });
  });
});

describe('v2 draft outcomes (R-BOARD-004 v2, R-SCORE-003 v2; b2-response D3, D4)', () => {
  // POD (advanced) on the start square. Letter points: letters-v1 P2 + O1 + D3 = 6; letters-v2 (L7) P2 + O1 + D2 = 5.
  const V1_LETTERS = 6;
  const V2_LETTERS = 5;
  const POD: Placement[] = [
    { row: 7, col: 6, tile: 'P' },
    { row: 7, col: 7, tile: 'O' },
    { row: 7, col: 8, tile: 'D' },
  ];

  function firstMove(cfg: MatchConfig, ctx: EngineContext): { wordMult: number; total: number } {
    const s = created(cfg, ctx);
    const obs: Observation = { ...observe(s, s.seatOnTurn), rack: 'DOP' };
    const r = evaluateMove(obs, { seat: s.seatOnTurn, type: 'PLACE_WORD', tiles: POD }, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const [main] = r.value.breakdown.words;
    return { wordMult: main?.wordMult ?? 0, total: r.value.breakdown.total };
  }

  it('R-BOARD-004: the start square is a DW in classic-v1 and plain in classic-v2', () => {
    expect(firstMove(config(1), CTX)).toEqual({ wordMult: 2, total: V1_LETTERS * 2 + 8 });
    expect(firstMove(config(2), DRAFT)).toEqual({ wordMult: 1, total: V2_LETTERS + 4 });
    // dx-dw: the v2 draft also runs the DW start (classic-v1) with letters-v2 and v2 bonuses.
    expect(firstMove(config(2, { layout: 'classic-v1' }), DRAFT)).toEqual({
      wordMult: 2,
      total: V2_LETTERS * 2 + 4,
    });
  });

  it('R-SCORE-003: the candidate picks the term bonus (advanced: v1 +8, tb-0-3-6-12 +6, tb-0-2-4-8 +4)', () => {
    expect(firstMove(config(2), draftCtx('tb-0-3-6-12', CTX)).total).toBe(V2_LETTERS + 6);
    expect(firstMove(config(2), draftCtx('tb-0-2-4-8', CTX)).total).toBe(V2_LETTERS + 4);
    expect(firstMove(config(2), DRAFT).total).toBe(V2_LETTERS + 4);
  });
});
