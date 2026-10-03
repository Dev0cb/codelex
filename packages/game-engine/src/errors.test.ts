import { describe, expect, it } from 'vitest';
import { assertNever } from './errors.js';

describe('assertNever (API note §17.5, review R1 n3)', () => {
  it('throws a TypeError when an ill-typed value reaches an exhaustive switch', () => {
    expect(() => assertNever('USE_POWER' as never)).toThrow(TypeError);
    expect(() => assertNever({ type: 'X' } as never)).toThrow('unexpected variant: object');
  });
});
