/**
 * Suite `replays/v1` (ADR-0013 §D5, RULE_PROPERTIES §3 GC-DET-01): the stored action log replayed from its header
 * with `parseActionLog` and `replay` on the frozen lexicon stored next to it.
 *
 * The log is replayed **without** its stored `stateHashes` (`recordHashes` instead), so a divergence shows as the
 * exact hashes that differ rather than as one `HASH_MISMATCH` error; the stored hashes are the expected values.
 * Cases: `GC-DET-01/log` (header and canonical bytes), `GC-DET-01/state-hashes/<from>-<to>` (30 actions each,
 * ADR-0016 §D3.1 "replays report their stateHashes", each under 1 KB) and `GC-DET-01/final` (final hash, first
 * seat, result).
 */
import { parseActionLog, replay, type ActionLog, type ReplayOutcome } from '@codelex/game-engine';
import { asciiBytes, canonicalJson, sha256Hex } from '@codelex/game-engine/canonical';

import { lazy, unwrap, type CaseSpec } from '../cases.js';
import {
  REPLAY_GC_DET_01_LEXICON_PATH,
  REPLAY_GC_DET_01_LOG_PATH,
  REPLAY_GC_DET_01_PATH,
  type GoldenCorpus,
} from '../corpus.js';
import { frozenForms, frozenLexicon } from '../fixtures/gc-det-01-lexicon.js';

export const REPLAYS_V1_SUITE = 'replays/v1';

/** Actions per `state-hashes` case: 30 hashes are about 570 canonical bytes, below the 1 KB `observed` limit. */
export const HASHES_PER_CASE = 30;

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export function replayCases(corpus: GoldenCorpus): CaseSpec[] {
  const meta = corpus[REPLAY_GC_DET_01_PATH];
  const storedLog = corpus[REPLAY_GC_DET_01_LOG_PATH];
  const frozen = corpus[REPLAY_GC_DET_01_LEXICON_PATH];
  const prefix = meta.id;

  const parsed = lazy((): ActionLog => unwrap(parseActionLog(canonicalJson(storedLog))));
  const replayed = lazy((): ReplayOutcome => {
    const log = parsed();
    const withoutHashes: ActionLog = {
      logVersion: log.logVersion,
      header: log.header,
      actions: log.actions,
    };
    return unwrap(
      replay(withoutHashes, { lexicon: frozenLexicon(frozen) }, { recordHashes: true }),
    );
  });

  const stored = storedLog.stateHashes;
  const chunks: CaseSpec[] = [];
  for (let from = 0; from < stored.length; from += HASHES_PER_CASE) {
    const to = Math.min(from + HASHES_PER_CASE, stored.length) - 1;
    chunks.push({
      id: `${prefix}/state-hashes/${pad3(from)}-${pad3(to)}`,
      run: () => ({
        observed: (replayed().stateHashes ?? []).slice(from, to + 1),
        expected: stored.slice(from, to + 1),
      }),
    });
  }

  return [
    {
      id: `${prefix}/log`,
      run: () => {
        const log = parsed();
        return {
          observed: {
            seed: log.header.seed,
            actions: log.actions.length,
            terms: frozenForms(frozen).length,
            sha256: sha256Hex(asciiBytes(canonicalJson(log))),
          },
          expected: {
            seed: meta.seed,
            actions: meta.actionCount,
            terms: frozen.termCount,
            sha256: sha256Hex(asciiBytes(canonicalJson(storedLog))),
          },
        };
      },
    },
    ...chunks,
    {
      id: `${prefix}/final`,
      run: () => {
        const outcome = replayed();
        return {
          observed: {
            finalStateHash: outcome.finalHash,
            firstSeat: outcome.state.firstSeat,
            result: outcome.state.result ?? 'none',
          },
          expected: {
            finalStateHash: meta.finalStateHash,
            firstSeat: meta.firstSeat,
            result: meta.result,
          },
        };
      },
    },
  ];
}
