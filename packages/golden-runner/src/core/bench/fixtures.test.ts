import { apply, createMatch, type MatchState } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';

import { BOT_DECISIONS_PATH, GOLDEN_CORPUS } from '../corpus.js';
import { syntheticClxiIndex } from '../fixtures/bot-fixtures.js';
import { GOLDEN_RUNNER_MARKER } from '../marker.js';
import { runGoldens } from '../run.js';
import { BOTS_SUITE } from '../suites/bots.js';
import type { CoreReport } from '../types.js';
import {
  decisionEquality,
  EQUALITY_POSITIONS_PER_BOT,
  formsOf,
  gcDet01Fixture,
  seededNonWords,
} from './fixtures.js';

let report: CoreReport | undefined;
function nodeReport(): CoreReport {
  report ??= runGoldens(GOLDEN_CORPUS, { runtime: { kind: 'node', version: 'v22.0.0' } });
  return report;
}

function withBotCases(
  base: CoreReport,
  change: (cases: CoreReport['suites'][number]['cases']) => CoreReport['suites'][number]['cases'],
): CoreReport {
  return {
    ...base,
    suites: base.suites.map((s) => (s.id === BOTS_SUITE ? { ...s, cases: change(s.cases) } : s)),
  };
}

describe('decision equality (P5 §7 item 4) from the runner report', { timeout: 120_000 }, () => {
  it('counts 20 equal golden positions per bot on a passing report', () => {
    const equality = decisionEquality(nodeReport(), GOLDEN_CORPUS);
    expect(equality).toEqual(
      ['random-legal', 'beginner', 'greedy', 'strategist'].map((botId) => ({
        botId,
        positions: EQUALITY_POSITIONS_PER_BOT,
        equal: EQUALITY_POSITIONS_PER_BOT,
        mismatchedPositionIds: [],
      })),
    );
  });

  it('names a position whose key differs, and one that errored', () => {
    const [first, second] = GOLDEN_CORPUS[BOT_DECISIONS_PATH].decisions;
    if (first === undefined || second === undefined) throw new Error('empty golden');
    const id = (d: typeof first): string => `${d.seed}/${String(d.actions)}/${d.personality}`;
    const changed = withBotCases(nodeReport(), (cases) =>
      cases.map((c) => {
        if (c.id === id(first)) return { id: c.id, status: 'fail', observed: { key: 'P:other' } };
        if (c.id === id(second)) return { id: c.id, status: 'error', errorCode: 'BOT_FAILED' };
        return c;
      }),
    );
    const equality = decisionEquality(changed, GOLDEN_CORPUS) ?? [];
    const mismatched = equality.flatMap((b) => b.mismatchedPositionIds);
    expect(mismatched).toEqual(
      expect.arrayContaining([
        `${first.seed}/${String(first.actions)}`,
        `${second.seed}/${String(second.actions)}`,
      ]),
    );
    expect(equality.every((b) => b.equal + b.mismatchedPositionIds.length === b.positions)).toBe(
      true,
    );
  });

  it('is null without a bots suite or with a bot that does not have 20 positions', () => {
    const base = nodeReport();
    expect(
      decisionEquality(
        { ...base, suites: base.suites.filter((s) => s.id !== BOTS_SUITE) },
        GOLDEN_CORPUS,
      ),
    ).toBeNull();
    const fewer = {
      ...GOLDEN_CORPUS,
      [BOT_DECISIONS_PATH]: {
        ...GOLDEN_CORPUS[BOT_DECISIONS_PATH],
        decisions: GOLDEN_CORPUS[BOT_DECISIONS_PATH].decisions.slice(1),
      },
    };
    expect(decisionEquality(base, fewer)).toBeNull();
    const none = {
      ...GOLDEN_CORPUS,
      [BOT_DECISIONS_PATH]: { ...GOLDEN_CORPUS[BOT_DECISIONS_PATH], decisions: [] },
    };
    expect(decisionEquality(base, none)).toBeNull();
  });
});

describe('apply and has() bench inputs', () => {
  it('replays the GC-DET-01 log action by action on its frozen lexicon', () => {
    const fixture = gcDet01Fixture(GOLDEN_CORPUS);
    expect(fixture.actions).toHaveLength(90);
    const created = createMatch(fixture.header, { lexicon: fixture.lexicon });
    if (!created.ok) throw new Error(created.error.code);
    let state: MatchState = created.value.state;
    for (const action of fixture.actions) {
      const applied = apply(state, action, { lexicon: fixture.lexicon });
      if (!applied.ok) throw new Error(applied.error.code);
      state = applied.value.state;
    }
    expect(state.actionCount).toBe(90);
  });

  it('lists every form and as many seeded non-words', () => {
    const lexicon = syntheticClxiIndex(2000, 1);
    const forms = formsOf(lexicon);
    expect(forms).toHaveLength(lexicon.size);
    expect(forms.every((f) => lexicon.has(f))).toBe(true);
    const nonWords = seededNonWords(lexicon, forms, forms.length);
    expect(nonWords).toHaveLength(forms.length);
    expect(nonWords.some((w) => lexicon.has(w))).toBe(false);
    expect(nonWords.map((w) => w.length)).toEqual(forms.map((f) => Math.max(2, f.length)));
    expect(seededNonWords(lexicon, forms, 10)).toEqual(nonWords.slice(0, 10));
    expect(seededNonWords(lexicon, [], 3)).toHaveLength(3);
  });

  it('exports the marker the app bundle check looks for', () => {
    expect(GOLDEN_RUNNER_MARKER).toBe('CODELEX_GOLDEN_RUNNER_V1');
  });
});
