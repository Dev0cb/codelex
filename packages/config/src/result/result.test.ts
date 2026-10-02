import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { err, isErr, isOk, ok, type Err, type Ok, type Result } from './index.js';

describe('Result', () => {
  it('ok(value) builds a plain success object', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('ok() without argument is a void success', () => {
    const r = ok();
    expect(r).toEqual({ ok: true, value: undefined });
    expectTypeOf(r).toEqualTypeOf<Ok<void>>();
  });

  it('err(error) builds a plain failure object', () => {
    expect(err({ code: 'E_X', message: 'boom' })).toEqual({
      ok: false,
      error: { code: 'E_X', message: 'boom' },
    });
  });

  it('narrows on the ok discriminant', () => {
    const r = ok(1) as Result<number, string>;
    if (r.ok) {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
    } else {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
    }
  });

  it('type guards agree with the discriminant', () => {
    const good = ok(7) as Result<number, string>;
    const bad = err('x') as Result<number, string>;
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
    if (isOk(good)) expectTypeOf(good.value).toEqualTypeOf<number>();
    if (isErr(bad)) expectTypeOf(bad.error).toEqualTypeOf<string>();
  });

  it('results are serialisable (JSON round trip)', () => {
    expect(JSON.parse(JSON.stringify(ok('a')))).toEqual(ok('a'));
    expect(JSON.parse(JSON.stringify(err('b')))).toEqual(err('b'));
  });

  it('property: ok(x) keeps x and is ok', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        const r = ok(x);
        expect(r.ok).toBe(true);
        return Object.is(r.value, x) && isOk(r) && !isErr(r);
      }),
    );
  });

  it('property: err(e) keeps e and is not ok', () => {
    fc.assert(
      fc.property(fc.anything(), (e) => {
        const r = err(e);
        expect(r.ok).toBe(false);
        return Object.is(r.error, e) && isErr(r) && !isOk(r);
      }),
    );
  });
});
