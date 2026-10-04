/**
 * Q4 full run: 1,000 seeded matches on the real global-ranked index and the real classic-v1 layout, moves chosen by
 * `chooseAction` (random-legal, Beginner, greedy, Strategist), 1v1 / 2v2 / FFA-3 / FFA-4. Same sequence as the gating run
 * (`test/real-lexicon-matches.test.ts`), which plays its first 250 matches.
 *
 *   pnpm --filter @codelex/bots test:full       run and compare with the recorded results
 *   pnpm --filter @codelex/bots test:full -u    re-record test/full/results/real-lexicon-1000.json
 *
 * Recorded results are the deterministic numbers (counts, end reasons, a digest of all 1,000 final state hashes), so a
 * later run proves the same matches replay to the same hashes. Wall-clock time is not recorded in the file (it is
 * not reproducible); it is noted in the sprint log. Any change of engine, bots, lexicon data or seeds changes the
 * digest on purpose: re-record in the same PR and say why.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { playRealMatch, realRankedIndex, summarize } from '../support/real-matches.js';

const MATCHES = 1000;
const RESULTS = './results/real-lexicon-1000.json';

describe('1,000 full matches on the real lexicon', () => {
  it('P-GLOBAL-05 P-GLOBAL-02 R-BAG-004: every match ends, conserves tiles and replays to identical hashes', async () => {
    const index = realRankedIndex();
    expect(index.gaddag).toBeDefined();
    const records = Array.from({ length: MATCHES }, (_, i) => playRealMatch(index, i));
    const { finalHashes, ...rest } = summarize(records);
    const digest = createHash('sha256').update(finalHashes).digest('hex').slice(0, 16);
    const result = {
      lexiconVersion: index.version,
      profile: index.profile.id,
      layout: 'classic-v1',
      ...rest,
      finalHashesDigest: digest,
    };

    expect(result.matches).toBe(MATCHES);
    expect(result.notEnded).toBe(0);
    expect(result.conservationBreaks).toBe(0);
    expect(result.replayMismatches).toBe(0);
    expect(
      result.byShape['2v2'] + result.byShape.ffa3 + result.byShape.ffa4,
    ).toBeGreaterThanOrEqual(MATCHES * 0.5);

    // Recorded results: a mismatch fails; `pnpm test:full -u` re-records (vitest file snapshot).
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(RESULTS);
  });
});
