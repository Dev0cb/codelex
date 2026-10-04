/**
 * Draft golden replays (ADR-0014 §D3): `test/golden/drafts/v2/` (mutable, not covered by the immutability check).
 * Each stored log must replay to its stored final hash with the draft opt-in and candidate, and be exactly what
 * the harness produces today. On an intentional draft change: `pnpm --filter @codelex/game-engine drafts:write`.
 */
import { describe, expect, it } from 'vitest';
import dxDw248 from '../../test/golden/drafts/v2/dx-dw-248.json' with { type: 'json' };
import v2248 from '../../test/golden/drafts/v2/v2-248.json' with { type: 'json' };
import v23612 from '../../test/golden/drafts/v2/v2-3612.json' with { type: 'json' };
import {
  buildDraftGolden,
  DRAFT_VARIANTS,
  type DraftGolden,
} from '../../test/drafts/draft-goldens.js';
import { ALLOW_DRAFT_RULES } from '../draft.js';
import { rulesDigest } from '../rules/registry.js';
import { parseActionLog, replay } from './log.js';

const STORED: Readonly<Record<string, DraftGolden>> = {
  'v2-3612': v23612,
  'v2-248': v2248,
  'dx-dw-248': dxDw248,
};

describe.each(DRAFT_VARIANTS.map((v) => [v.id, v] as const))(
  'draft golden replay %s (ADR-0014 §D3; P-GLOBAL-02)',
  (id, variant) => {
    const stored = STORED[id] as DraftGolden;

    it('was written for the current draft tables (else regenerate: pnpm drafts:write)', () => {
      expect(stored.rulesDigest).toBe(rulesDigest(2));
      expect(stored.candidate).toBe(variant.ctx.draft?.candidate);
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
      expect(buildDraftGolden(variant)).toEqual(stored);
    });
  },
);

describe('draft goldens differ by variant (the candidate and the layout are outcome-relevant)', () => {
  it('three distinct final hashes', () => {
    const finals = Object.values(STORED).map((g) => g.finalStateHash);
    expect(new Set(finals).size).toBe(finals.length);
  });
});
