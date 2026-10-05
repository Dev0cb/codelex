/**
 * Draft golden replays (ADR-0014 §D3): `test/golden/drafts/v2/` (mutable, not covered by the immutability check).
 * Each stored log must replay to its stored final hash with the draft opt-in and candidate, and be exactly what
 * the harness produces today. On an intentional draft change: `pnpm --filter @codelex/game-engine drafts:write`.
 */
import { describe, expect, it } from 'vitest';
import dxDw248Full from '../../test/golden/drafts/v2/dx-dw-248-full.json' with { type: 'json' };
import dxDw248 from '../../test/golden/drafts/v2/dx-dw-248.json' with { type: 'json' };
import v2248Full from '../../test/golden/drafts/v2/v2-248-full.json' with { type: 'json' };
import v2248 from '../../test/golden/drafts/v2/v2-248.json' with { type: 'json' };
import v23612Full from '../../test/golden/drafts/v2/v2-3612-full.json' with { type: 'json' };
import v23612 from '../../test/golden/drafts/v2/v2-3612.json' with { type: 'json' };
import {
  buildDraftGolden,
  DRAFT_GOLDENS,
  type DraftGolden,
  FULL_SEED,
} from '../../test/drafts/draft-goldens.js';
import { ALLOW_DRAFT_RULES } from '../draft.js';
import { rulesDigest } from '../rules/registry.js';
import type { MatchState } from '../types.js';
import { parseActionLog, replay } from './log.js';

const STORED: Readonly<Record<string, DraftGolden>> = {
  'v2-3612': v23612,
  'v2-3612-full': v23612Full,
  'v2-248': v2248,
  'v2-248-full': v2248Full,
  'dx-dw-248': dxDw248,
  'dx-dw-248-full': dxDw248Full,
};

describe.each(DRAFT_GOLDENS.map((g) => [g.file, g] as const))(
  'draft golden replay %s (ADR-0014 §D3; P-GLOBAL-02)',
  (file, { variant, seed }) => {
    const stored = STORED[file] as DraftGolden;

    it('was written for the current draft tables and seed (else regenerate: pnpm drafts:write)', () => {
      expect(stored.rulesDigest).toBe(rulesDigest(2));
      expect(stored.candidate).toBe(variant.ctx.draft?.candidate);
      expect(stored.variant).toBe(variant.id);
      expect(stored.seed).toBe(seed);
    });

    it('replays to its stored final hash, every checkpoint verified', () => {
      const parsed = parseActionLog(stored.log, { draft: { optIn: ALLOW_DRAFT_RULES } });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
      expect(parsed.value.header.engineRulesVersion).toBe(2);
      expect(parsed.value.header.config.layout).toBe(variant.layout);
      const r = replay(parsed.value, variant.ctx);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      expect(r.value.finalHash).toBe(stored.finalStateHash);
      expect(r.value.state.status).toBe('finished');
    });

    it('is exactly what the harness plays today (deterministic)', () => {
      expect(buildDraftGolden(variant, seed)).toEqual(stored);
    });
  },
);

describe('the -full draft goldens cover EXCHANGE and the end of the bag (R-BAG-005, R-BAG-003)', () => {
  it.each(DRAFT_GOLDENS.filter((g) => g.seed === FULL_SEED).map((g) => [g.file, g] as const))(
    '%s: at least one EXCHANGE, no RESIGN, the bag is empty at the end',
    (file, { variant }) => {
      const stored = STORED[file] as DraftGolden;
      const parsed = parseActionLog(stored.log, { draft: { optIn: ALLOW_DRAFT_RULES } });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
      const types = parsed.value.actions.map((a) => a.type);
      expect(types).toContain('EXCHANGE');
      expect(types).not.toContain('RESIGN');
      const r = replay(parsed.value, variant.ctx);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      const final: MatchState = r.value.state;
      expect(final.bag).toHaveLength(0);
    },
  );
});

describe('draft goldens differ by variant (the candidate and the layout are outcome-relevant)', () => {
  it('six distinct final hashes', () => {
    const finals = Object.values(STORED).map((g) => g.finalStateHash);
    expect(finals).toHaveLength(6);
    expect(new Set(finals).size).toBe(finals.length);
  });
});
