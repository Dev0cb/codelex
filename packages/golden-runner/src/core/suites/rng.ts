/**
 * Suite `rng` (ADR-0013 Appendix A.1, `rng.json`): stream derivation, the first `next()` outputs, `int(lo, hi)`
 * series and the 0..9 shuffle of every case, through `@codelex/game-engine/rng` only. Case id `<seed>/<stream>`.
 */
import {
  createRng,
  deriveRng,
  deriveStreamState,
  isSeedHex,
  isStreamName,
} from '@codelex/game-engine/rng';

import { CaseError, type CaseSpec } from '../cases.js';
import { RNG_PATH, type GoldenCorpus } from '../corpus.js';

export const RNG_SUITE = 'rng';

export function rngCases(corpus: GoldenCorpus): CaseSpec[] {
  return corpus[RNG_PATH].cases.map((c) => ({
    id: `${c.seed}/${c.stream}`,
    run: () => {
      const { seed, stream } = c;
      if (!isSeedHex(seed) || !isStreamName(stream)) throw new CaseError('CORPUS_MALFORMED');
      const state = deriveStreamState(seed, stream);
      const derived = deriveRng(seed, stream);
      const next = c.next.map(() => derived.next());
      const int = c.int.map((series) => {
        const rng = createRng(state);
        return {
          lo: series.lo,
          hi: series.hi,
          values: series.values.map(() => rng.int(series.lo, series.hi)),
        };
      });
      const shuffle = createRng(state).shuffle(c.shuffle.input);
      return {
        observed: { state, next, int, shuffle },
        expected: { state: c.state, next: c.next, int: c.int, shuffle: c.shuffle.output },
      };
    },
  }));
}
