import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import golden from '../../test/golden/rng.json' with { type: 'json' };
import {
  RNG_ALGORITHM,
  RNG_DERIVATION,
  createRng,
  deriveRng,
  deriveStreamState,
  isSeedHex,
  isStreamName,
  stateFromDigest,
  type Rng,
  type RngState,
} from './rng.js';

const TWO_POW_32 = 0x1_0000_0000;

const u32 = fc.integer({ min: 0, max: 0xffff_ffff });
/** Any legal xoshiro128** state (not all zero). */
const stateArb: fc.Arbitrary<RngState> = fc
  .tuple(u32, u32, u32, u32)
  .filter((s) => s.some((w) => w !== 0));
const seedArb = fc
  .bigInt({ min: 0n, max: (1n << 64n) - 1n })
  .map((v) => v.toString(16).padStart(16, '0'));
const streamArb = fc.oneof(
  fc.constantFrom('bag', 'first-player', 'bot:0', 'bot:1'),
  fc
    .tuple(fc.integer({ min: 0, max: 7 }), fc.nat({ max: 400 }))
    .map(([seat, n]) => `bot:${String(seat)}:${String(n)}`),
);

function take(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.next());
}

/** Wraps an Rng to count raw outputs consumed by `int`/`shuffle` (white-box model of §D1). */
function rawModel(state: RngState): { readonly draw: () => number; readonly count: () => number } {
  const raw = createRng(state);
  let consumed = 0;
  return {
    draw: () => {
      consumed++;
      return raw.next();
    },
    count: () => consumed,
  };
}

describe('rng golden vectors (ADR-0013 Appendix A, normative)', () => {
  it('has the A.1 file header', () => {
    expect(golden.format).toBe(1);
    expect(golden.algorithm).toBe(RNG_ALGORITHM);
    expect(golden.derivation).toBe(RNG_DERIVATION);
    expect(golden.cases).toHaveLength(9);
  });

  for (const c of golden.cases) {
    describe(`${c.seed} / ${c.stream}`, () => {
      const state = c.state as unknown as RngState;

      it('derives the state', () => {
        expect(deriveStreamState(c.seed, c.stream)).toEqual(state);
        expect(deriveRng(c.seed, c.stream).state()).toEqual(state);
      });

      it('produces the first next() outputs', () => {
        expect(take(createRng(state), c.next.length)).toEqual(c.next);
        expect(take(deriveRng(c.seed, c.stream), c.next.length)).toEqual(c.next);
      });

      for (const series of c.int) {
        it(`produces int(${String(series.lo)}, ${String(series.hi)})`, () => {
          const rng = createRng(state);
          expect(series.values.map(() => rng.int(series.lo, series.hi))).toEqual(series.values);
        });
      }

      it('shuffles 0..9', () => {
        expect(createRng(state).shuffle(c.shuffle.input)).toEqual(c.shuffle.output);
      });
    });
  }

  it('A.2 rejection-sampling vector rejects exactly the two raw outputs >= limit (10 raw draws)', () => {
    const state = deriveStreamState('00c0de1e00000001', 'bag');
    const rng = createRng(state);
    const values = Array.from({ length: 8 }, () => rng.int(0, 3_221_225_472));
    expect(values).toEqual([
      1204966949, 1544239233, 1025015925, 1571986059, 690393948, 1329916797, 519333301, 2893210056,
    ]);
    const raw = take(createRng(state), 10);
    expect(raw.filter((x) => x >= 3_221_225_472)).toEqual([3784047710, 3400854581]);
    expect(rng.state()).toEqual(advance(state, 10));
  });

  it('bare generator sanity check: state [1, 2, 3, 4]', () => {
    expect(take(createRng([1, 2, 3, 4]), 8)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
    ]);
  });
});

function advance(state: RngState, steps: number): RngState {
  const rng = createRng(state);
  take(rng, steps);
  return rng.state();
}

describe('stream derivation (ADR-0013 §D1)', () => {
  it('is the first 16 bytes of SHA-256(seedHex ":" stream) as 4 big-endian u32 (vs node:crypto)', () => {
    fc.assert(
      fc.property(seedArb, streamArb, (seed, stream) => {
        const digest = createHash('sha256').update(`${seed}:${stream}`, 'ascii').digest();
        const expected = [0, 4, 8, 12].map((o) => digest.readUInt32BE(o));
        expect(deriveStreamState(seed, stream)).toEqual(expected);
      }),
    );
  });

  it('maps an all-zero digest prefix to s0 = 1', () => {
    const digest = new Uint8Array(32);
    digest.fill(0xab, 16);
    expect(stateFromDigest(digest)).toEqual([1, 0, 0, 0]);
  });

  it('reads big-endian words and ignores bytes 16..31', () => {
    const digest = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    expect(stateFromDigest(digest)).toEqual([0x01020304, 0x05060708, 0x090a0b0c, 0x0d0e0f10]);
    expect(
      stateFromDigest(Uint8Array.of(0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x80)),
    ).toEqual([0xff000000, 0, 0, 0x80]);
  });

  it('rejects a digest shorter than 16 bytes', () => {
    expect(() => stateFromDigest(new Uint8Array(15))).toThrow(RangeError);
  });

  it('validates seeds: exactly 16 lowercase hex chars', () => {
    expect(isSeedHex('00c0de1e00000001')).toBe(true);
    for (const bad of [
      '',
      '00C0DE1E00000001',
      '00c0de1e0000001',
      '00c0de1e000000011',
      '0x00c0de1e000000',
      'g000000000000000',
    ]) {
      expect(isSeedHex(bad), bad).toBe(false);
      expect(() => deriveStreamState(bad, 'bag'), bad).toThrow(RangeError);
    }
  });

  it('validates stream names (decimal integers without leading zeros)', () => {
    for (const ok of ['bag', 'first-player', 'bot:1', 'bot:0:0', 'bot:3:120', 'a1-b']) {
      expect(isStreamName(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      'Bag',
      '1bag',
      'bot:',
      'bot:01',
      'bot:1:',
      'bot:-1',
      'bot:x',
      'bag ',
      'bäg',
      ':1',
    ]) {
      expect(isStreamName(bad), bad).toBe(false);
      expect(() => deriveStreamState('0000000000000000', bad), bad).toThrow(RangeError);
    }
  });
});

describe('determinism and independence (P-GLOBAL-01/02, R-CORE-005)', () => {
  it('same seed and stream give the same sequence', () => {
    fc.assert(
      fc.property(seedArb, streamArb, (seed, stream) => {
        expect(take(deriveRng(seed, stream), 16)).toEqual(take(deriveRng(seed, stream), 16));
      }),
    );
  });

  it('streams are independent: interleaved draws from another stream never shift a stream', () => {
    fc.assert(
      fc.property(seedArb, fc.array(fc.boolean(), { maxLength: 64 }), (seed, schedule) => {
        const alone = deriveRng(seed, 'bag');
        const expected = schedule.filter((b) => b).map(() => alone.next());
        const bag = deriveRng(seed, 'bag');
        const bot = deriveRng(seed, 'bot:1:0');
        const actual: number[] = [];
        for (const fromBag of schedule) {
          if (fromBag) actual.push(bag.next());
          else bot.next();
        }
        expect(actual).toEqual(expected);
      }),
    );
  });

  it('distinct stream names and distinct seeds derive distinct states', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.uniqueArray(streamArb, { minLength: 2, maxLength: 6 }),
        (seed, streams) => {
          const states = new Set(streams.map((s) => deriveStreamState(seed, s).join(',')));
          expect(states.size).toBe(streams.length);
        },
      ),
    );
    fc.assert(
      fc.property(fc.uniqueArray(seedArb, { minLength: 2, maxLength: 6 }), (seeds) => {
        const states = new Set(seeds.map((s) => deriveStreamState(s, 'bag').join(',')));
        expect(states.size).toBe(seeds.length);
      }),
    );
  });

  it('state() snapshots resume the exact sequence (persisted rng.bag, ADR-0013 §D3)', () => {
    fc.assert(
      fc.property(stateArb, fc.nat({ max: 50 }), (state, skip) => {
        const rng = createRng(state);
        take(rng, skip);
        const snapshot = rng.state();
        const expected = take(rng, 8);
        expect(take(createRng(snapshot), 8)).toEqual(expected);
      }),
    );
  });

  it('never mutates the state it was created from, nor exposes its internal state', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const input = [...state] as const;
        const rng = createRng(input);
        const snapshot = rng.state();
        take(rng, 5);
        expect(input).toEqual(state);
        expect(snapshot).toEqual(state);
        expect(Object.isFrozen(snapshot)).toBe(true);
      }),
    );
  });

  it('outputs are u32 integers', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        for (const x of take(createRng(state), 32)) {
          expect(Number.isInteger(x) && x >= 0 && x < TWO_POW_32).toBe(true);
        }
      }),
    );
  });
});

describe('createRng state validation', () => {
  it('rejects the all-zero state (forbidden for xoshiro128**)', () => {
    expect(() => createRng([0, 0, 0, 0])).toThrow(RangeError);
  });

  it('rejects words that are not u32 integers', () => {
    for (const bad of [-1, TWO_POW_32, 1.5, Number.NaN]) {
      expect(() => createRng([1, bad, 0, 0]), String(bad)).toThrow(RangeError);
    }
    expect(() => createRng([1, 2, 3] as unknown as RngState)).toThrow(RangeError);
  });
});

describe('int(lo, hi) (ADR-0013 §D1)', () => {
  const rangeArb = fc
    .tuple(
      fc.integer({ min: -0x100_0000_0000, max: 0x100_0000_0000 }),
      fc.integer({ min: 1, max: TWO_POW_32 }),
    )
    .map(([lo, n]) => ({ lo, hi: lo + n }));

  it('returns an integer in [lo, hi)', () => {
    fc.assert(
      fc.property(stateArb, rangeArb, (state, { lo, hi }) => {
        const rng = createRng(state);
        for (let i = 0; i < 8; i++) {
          const v = rng.int(lo, hi);
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v >= lo && v < hi).toBe(true);
        }
      }),
    );
  });

  it('is rejection sampling: first raw x < 2^32 - (2^32 mod n), mapped to lo + x mod n', () => {
    const nArb = fc.oneof(
      fc.integer({ min: 1, max: 1000 }),
      fc.integer({ min: 0x8000_0000, max: TWO_POW_32 }),
      fc.integer({ min: 1, max: TWO_POW_32 }),
    );
    fc.assert(
      fc.property(stateArb, fc.integer({ min: -1000, max: 1000 }), nArb, (state, lo, n) => {
        const model = rawModel(state);
        const limit = TWO_POW_32 - (TWO_POW_32 % n);
        let x = model.draw();
        while (x >= limit) x = model.draw();
        const rng = createRng(state);
        expect(rng.int(lo, lo + n)).toBe(lo + (x % n));
        expect(rng.state()).toEqual(advance(state, model.count()));
      }),
    );
  });

  it('always consumes exactly one output when no rejection can happen (n = 1, n = 2^32, powers of two)', () => {
    fc.assert(
      fc.property(stateArb, fc.constantFrom(1, 2, 64, 0x8000_0000, TWO_POW_32), (state, n) => {
        const rng = createRng(state);
        const raw = createRng(state).next();
        expect(rng.int(0, n)).toBe(raw % n);
        expect(rng.state()).toEqual(advance(state, 1));
      }),
    );
  });

  it('throws on programmer errors (empty range, too wide, non-integers, unsafe integers)', () => {
    const rng = createRng([1, 2, 3, 4]);
    const before = rng.state();
    expect(() => rng.int(0, 0)).toThrow(RangeError);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0, TWO_POW_32 + 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 3)).toThrow(RangeError);
    expect(() => rng.int(0, 2.5)).toThrow(RangeError);
    expect(() => rng.int(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => rng.int(Number.NaN, 1)).toThrow(RangeError);
    expect(rng.state()).toEqual(before);
  });
});

describe('shuffle (Fisher-Yates, R-BAG-005)', () => {
  it('returns a permutation of its input and never mutates it', () => {
    fc.assert(
      fc.property(
        stateArb,
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 120 }),
        (state, items) => {
          const input = [...items];
          const out = createRng(state).shuffle(input);
          expect(input).toEqual(items);
          expect(out).not.toBe(input);
          const byValue = (a: number, b: number): number => a - b;
          expect([...out].sort(byValue)).toEqual([...items].sort(byValue));
        },
      ),
    );
  });

  it('is the descending variant: j = int(0, i + 1) for i = len - 1 .. 1, swap a[i], a[j]', () => {
    fc.assert(
      fc.property(
        stateArb,
        fc.array(fc.string({ maxLength: 2 }), { maxLength: 40 }),
        (state, items) => {
          const model = createRng(state);
          const expected = [...items];
          for (let i = expected.length - 1; i >= 1; i--) {
            const j = model.int(0, i + 1);
            const tmp = expected[i] as string;
            expected[i] = expected[j] as string;
            expected[j] = tmp;
          }
          const rng = createRng(state);
          expect(rng.shuffle(items)).toEqual(expected);
          expect(rng.state()).toEqual(model.state());
        },
      ),
    );
  });

  it('consumes nothing for 0 or 1 items', () => {
    const rng = createRng([1, 2, 3, 4]);
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['?'])).toEqual(['?']);
    expect(rng.state()).toEqual([1, 2, 3, 4]);
  });
});
