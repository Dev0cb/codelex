/**
 * Bench inputs taken from the corpus and the runner report (DG1 note §5): decision equality per bot (P5 §7 item 4,
 * read off the `bots/decisions-b2-r1` suite), the GC-DET-01 log and its frozen lexicon for the `apply` bench, and
 * the word lists of the `has()` bench. Pure; fixture code, not rules.
 */
import { parseActionLog, type Action, type MatchConfig } from '@codelex/game-engine';
import { canonicalJson } from '@codelex/game-engine/canonical';
import { createRng, type RngState } from '@codelex/game-engine/rng';
import type { FormRef, LexiconIndex } from '@codelex/lexicon/index';

import { unwrap } from '../cases.js';
import {
  BOT_DECISIONS_PATH,
  REPLAY_GC_DET_01_LEXICON_PATH,
  REPLAY_GC_DET_01_LOG_PATH,
  type GoldenCorpus,
} from '../corpus.js';
import { frozenLexicon } from '../fixtures/gc-det-01-lexicon.js';
import { BOTS_SUITE } from '../suites/bots.js';
import type { CoreReport } from '../types.js';

/** Golden positions per bot in the decision-equality bench (A2 `DECISION_POSITIONS_PER_BOT`, P5 §7 item 4). */
export const EQUALITY_POSITIONS_PER_BOT = 20;

export interface DecisionEquality {
  readonly botId: string;
  readonly positions: number;
  readonly equal: number;
  /** `<seed>/<actions>` of each golden position whose device decision key differs (or errored). */
  readonly mismatchedPositionIds: readonly string[];
}

const keyOf = (observed: unknown): unknown =>
  typeof observed === 'object' && observed !== null && 'key' in observed
    ? (observed as { readonly key: unknown }).key
    : undefined;

/**
 * Decision equality per bot from a runner report: for each personality of the bots golden, the pinned positions
 * whose decision key computed by this runtime equals the Node golden key. `null` when the report has no bots suite
 * or a bot does not have exactly {@link EQUALITY_POSITIONS_PER_BOT} positions (then the bench is not measured).
 */
export function decisionEquality(
  report: CoreReport,
  corpus: GoldenCorpus,
): DecisionEquality[] | null {
  const suite = report.suites.find((s) => s.id === BOTS_SUITE);
  if (suite === undefined) return null;
  const byId = new Map(suite.cases.map((c) => [c.id, c]));
  const bots = new Map<string, { equal: number; mismatched: string[] }>();
  for (const d of corpus[BOT_DECISIONS_PATH].decisions) {
    const position = `${d.seed}/${String(d.actions)}`;
    const entry = bots.get(d.personality) ?? { equal: 0, mismatched: [] };
    bots.set(d.personality, entry);
    const found = byId.get(`${position}/${d.personality}`);
    const same =
      found !== undefined &&
      found.status !== 'error' &&
      canonicalJson(keyOf(found.observed)) === canonicalJson(d.key);
    if (same) entry.equal += 1;
    else entry.mismatched.push(position);
  }
  const out = [...bots.entries()].map(([botId, { equal, mismatched }]) => ({
    botId,
    positions: equal + mismatched.length,
    equal,
    mismatchedPositionIds: mismatched,
  }));
  return out.length > 0 && out.every((b) => b.positions === EQUALITY_POSITIONS_PER_BOT)
    ? out
    : null;
}

/** The GC-DET-01 match as the `apply` bench replays it: header, actions and the frozen lexicon. */
export interface ReplayFixture {
  readonly header: MatchConfig;
  readonly actions: readonly Action[];
  readonly lexicon: LexiconIndex;
}

export function gcDet01Fixture(corpus: GoldenCorpus): ReplayFixture {
  const log = unwrap(parseActionLog(canonicalJson(corpus[REPLAY_GC_DET_01_LOG_PATH])));
  return {
    header: log.header,
    actions: log.actions,
    lexicon: frozenLexicon(corpus[REPLAY_GC_DET_01_LEXICON_PATH]),
  };
}

/** Every playable form of `lexicon` (FormRefs are dense ordinals `0..size-1`). */
export function formsOf(lexicon: LexiconIndex): string[] {
  const forms: string[] = [];
  for (let ref = 0; ref < lexicon.size; ref += 1) forms.push(lexicon.formMeta(ref as FormRef).form);
  return forms;
}

/**
 * `count` seeded strings of `A`–`Z` that are not forms of `lexicon`, with the lengths of `forms` in turn (the
 * `has()` bench queries as many non-words as words). Deterministic for a seed.
 */
export function seededNonWords(
  lexicon: LexiconIndex,
  forms: readonly string[],
  count: number,
  seed: RngState = [0x6e6f6e77, 0x6f726473, 1, 2],
): string[] {
  const rng = createRng(seed);
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count * 100; i += 1) {
    const length = Math.max(2, forms[out.length % Math.max(1, forms.length)]?.length ?? 5);
    let word = '';
    for (let j = 0; j < length; j += 1) word += String.fromCharCode(65 + rng.int(0, 26));
    if (!lexicon.has(word)) out.push(word);
  }
  return out;
}
