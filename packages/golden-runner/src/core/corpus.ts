/**
 * The golden corpus (ADR-0016 §D3 items 2–3): the published, immutable golden files of `@codelex/game-engine` and
 * `@codelex/bots`, imported as JSON so that every host (tsc build on Node, Metro bundle on Hermes, the app in DG1)
 * embeds the same values. Keys are repository paths: they name the files in `corpus.digest` and in reviews.
 *
 * Drafts (`test/golden/drafts/`) are out of scope and not exported by the engine. A new frozen rules version adds
 * its files here, its suite in `run.ts` and its export subpath in the same PR (§D3 item 3).
 */
import botDecisions from '@codelex/bots/golden/decisions-b2-r1.json' with { type: 'json' };
import jcs from '@codelex/game-engine/golden/jcs.json' with { type: 'json' };
import gcDet01Lexicon from '@codelex/game-engine/golden/replays/v1/gc-det-01.lexicon.json' with { type: 'json' };
import gcDet01Log from '@codelex/game-engine/golden/replays/v1/gc-det-01.log.json' with { type: 'json' };
import gcDet01 from '@codelex/game-engine/golden/replays/v1/gc-det-01.json' with { type: 'json' };
import rng from '@codelex/game-engine/golden/rng.json' with { type: 'json' };
import classic from '@codelex/game-engine/golden/scoring/v1/classic.json' with { type: 'json' };
import inflections from '@codelex/game-engine/golden/scoring/v1/inflections.json' with { type: 'json' };
import sha256 from '@codelex/game-engine/golden/sha256.json' with { type: 'json' };

export const RNG_PATH = 'packages/game-engine/test/golden/rng.json';
export const SHA256_PATH = 'packages/game-engine/test/golden/sha256.json';
export const JCS_PATH = 'packages/game-engine/test/golden/jcs.json';
export const SCORING_CLASSIC_PATH = 'packages/game-engine/test/golden/scoring/v1/classic.json';
export const SCORING_INFLECTIONS_PATH =
  'packages/game-engine/test/golden/scoring/v1/inflections.json';
export const REPLAY_GC_DET_01_PATH = 'packages/game-engine/test/golden/replays/v1/gc-det-01.json';
export const REPLAY_GC_DET_01_LOG_PATH =
  'packages/game-engine/test/golden/replays/v1/gc-det-01.log.json';
export const REPLAY_GC_DET_01_LEXICON_PATH =
  'packages/game-engine/test/golden/replays/v1/gc-det-01.lexicon.json';
export const BOT_DECISIONS_PATH = 'packages/bots/test/golden/decisions-b2-r1.json';

/** Every corpus file, by repository path. Values are the decoded JSON documents, never modified by the runner. */
export interface GoldenCorpus {
  readonly [RNG_PATH]: typeof rng;
  readonly [SHA256_PATH]: typeof sha256;
  readonly [JCS_PATH]: typeof jcs;
  readonly [SCORING_CLASSIC_PATH]: typeof classic;
  readonly [SCORING_INFLECTIONS_PATH]: typeof inflections;
  readonly [REPLAY_GC_DET_01_PATH]: typeof gcDet01;
  readonly [REPLAY_GC_DET_01_LOG_PATH]: typeof gcDet01Log;
  readonly [REPLAY_GC_DET_01_LEXICON_PATH]: typeof gcDet01Lexicon;
  readonly [BOT_DECISIONS_PATH]: typeof botDecisions;
}

/** The corpus as published at this commit. */
export const GOLDEN_CORPUS: GoldenCorpus = {
  [RNG_PATH]: rng,
  [SHA256_PATH]: sha256,
  [JCS_PATH]: jcs,
  [SCORING_CLASSIC_PATH]: classic,
  [SCORING_INFLECTIONS_PATH]: inflections,
  [REPLAY_GC_DET_01_PATH]: gcDet01,
  [REPLAY_GC_DET_01_LOG_PATH]: gcDet01Log,
  [REPLAY_GC_DET_01_LEXICON_PATH]: gcDet01Lexicon,
  [BOT_DECISIONS_PATH]: botDecisions,
};
