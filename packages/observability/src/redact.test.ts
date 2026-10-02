import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLogger, type LogDestination } from './logger.js';
import {
  createRedactor,
  MAX_DEPTH,
  MAX_STRING_LENGTH,
  normalizeKey,
  REDACTED,
  SENSITIVE_KEY_FRAGMENTS,
} from './redact.js';

const redactor = createRedactor();
const sanitize = (v: unknown): unknown => redactor.sanitize(v);

function logOnce(fields: unknown, message?: string): string {
  const buf: string[] = [];
  const dest: LogDestination = { write: (l) => buf.push(l) };
  const log = createLogger({ service: 'test', level: 'debug', destination: dest });
  log.info(fields as Record<string, unknown>, message);
  const out = buf.join('');
  JSON.parse(out); // the output must remain valid JSON
  return out;
}

describe('key-based redaction', () => {
  const secretKeys = [
    'accessToken',
    'access_token',
    'refreshToken',
    'idToken',
    'token',
    'bearer',
    'Authorization',
    'authorization',
    'x-api-key',
    'apiKey',
    'API_KEY',
    'password',
    'newPassword',
    'clientSecret',
    'cookie',
    'Set-Cookie',
    'email',
    'Email',
    'user_email',
    'E-Mail',
    'receipt',
    'receipt-data',
    'transactionReceipt',
    'purchaseToken',
    'signedTransactionInfo',
    'signedRenewalInfo',
    'jwsRepresentation',
    'originalJson',
    'purchaseData',
    'signature',
    'body',
    'rawBody',
    'requestBody',
  ];

  it.each(secretKeys)('redacts %s', (key) => {
    const out = logOnce({ [key]: 'VALUE-123' });
    expect(out).not.toContain('VALUE-123');
    expect(out).toContain(REDACTED);
  });

  it('redacts case and separator variants and compatibility characters', () => {
    expect(redactor.isSensitiveKey('ACCESS-TOKEN')).toBe(true);
    expect(redactor.isSensitiveKey('ａｃｃｅｓｓＴｏｋｅｎ')).toBe(true); // full-width
    expect(redactor.isSensitiveKey('pass word'.replace(' ', ''))).toBe(true);
    expect(redactor.isSensitiveKey('matchId')).toBe(false);
    expect(redactor.isSensitiveKey('traceId')).toBe(false);
    expect(redactor.isSensitiveKey('spanId')).toBe(false);
    expect(normalizeKey('Set-Cookie')).toBe('setcookie');
  });

  it('redacts whole subtrees under a secret key, whatever their shape', () => {
    const out = logOnce({ headers: { Authorization: { nested: ['Bearer xyz'] } }, ok: 1 });
    expect(out).not.toContain('xyz');
    expect(out).toContain('"ok":1');
  });

  it('finds secrets nested in objects, arrays, Maps, Sets and class instances', () => {
    class Holder {
      constructor(public readonly password: string) {}
    }
    const out = logOnce({
      a: [{ b: { c: [{ refreshToken: 'DEEP-1' }] } }],
      m: new Map([['apiKey', 'DEEP-2']]),
      m2: new Map<unknown, unknown>([[{ k: 1 }, 'v']]),
      s: new Set([{ secret: 'DEEP-3' }]),
      h: new Holder('DEEP-4'),
      x: { toJSON: () => ({ token: 'DEEP-5' }) },
    });
    for (const n of [1, 2, 3, 4, 5]) expect(out).not.toContain(`DEEP-${String(n)}`);
  });

  it('redacts secret-looking keys that are themselves emails and keeps non-secret data', () => {
    const out = logOnce({ 'bob@example.com': 1, matchId: 'm-1', score: 42 });
    expect(out).not.toContain('bob@example.com');
    expect(out).toContain('"matchId":"m-1"');
    expect(out).toContain('"score":42');
  });
});

describe('value-based redaction', () => {
  it.each([
    'bob@example.com',
    'first.last+tag@sub.example.co.uk',
    'BOB@EXAMPLE.COM',
    'bob%40example.com',
    'élodie@exämple.fr',
  ])('removes email %s inside strings', (email) => {
    const out = logOnce({ note: `contact ${email}, thanks`, list: [`<${email}>`] }, `msg ${email}`);
    expect(out.toLowerCase()).not.toContain(email.toLowerCase());
    expect(out).toContain('contact');
  });

  it('removes bearer tokens, JWTs and key=value secrets from strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl';
    const out = logOnce({
      a: `Authorization: Bearer abc123.def`,
      b: `got ${jwt} here`,
      c: 'url?access_token=SEKRET1&x=1',
      d: 'password: "hunter2"',
      e: "api_key='K-9'",
    });
    for (const s of ['abc123', jwt, 'SEKRET1', 'hunter2', 'K-9']) expect(out).not.toContain(s);
  });

  it('applies caller supplied patterns and keys', () => {
    const r = createRedactor({ extraKeys: ['friend code'], extraPatterns: [/ZZ-\d+/i] });
    expect(r.sanitize({ FriendCode: 'a', t: 'x zz-9 y' })).toEqual({
      FriendCode: REDACTED,
      t: `x ${REDACTED} y`,
    });
    expect(() => createRedactor({ extraKeys: ['!!'] })).toThrow(TypeError);
  });
});

describe('errors', () => {
  it('serialises type, scrubbed message, stack, cause and own props', () => {
    const cause = new Error('inner for a@b.io');
    const err = Object.assign(new TypeError('boom token=SEKRET2 for z@y.org', { cause }), {
      code: 'E_X',
      config: { headers: { Authorization: 'Bearer q' }, url: '/x' },
      password: 'pw-1',
    });
    const out = logOnce({ err });
    for (const s of ['SEKRET2', 'z@y.org', 'a@b.io', 'pw-1', 'Bearer q']) {
      expect(out).not.toContain(s);
    }
    const parsed = JSON.parse(out) as { err: Record<string, unknown> };
    expect(parsed.err['type']).toBe('TypeError');
    expect(parsed.err['code']).toBe('E_X');
    expect(parsed.err['stack']).toEqual(expect.any(String));
    expect(parsed.err['cause']).toBeDefined();
  });

  it('serialises AggregateError members and errors without a stack', () => {
    const inner = new Error('x a@b.io');
    delete inner.stack;
    const out = logOnce({ err: new AggregateError([inner], 'agg') });
    expect(out).not.toContain('a@b.io');
    expect(out).toContain('agg');
  });

  it('keeps an explicit own cause property instead of duplicating it', () => {
    const e = Object.assign(new Error('x'), { cause: 'c@d.io' });
    expect(JSON.stringify(sanitize(e))).not.toContain('c@d.io');
  });

  it('survives throwing getters', () => {
    const e = new Error('x');
    Object.defineProperty(e, 'bad', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(JSON.stringify(sanitize(e))).toContain('[Unreadable]');
  });
});

describe('robustness', () => {
  it('handles cycles, depth, bigint, symbols, functions, binary and dates', () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc['self'] = cyc;
    let deep: unknown = { leaf: 'x@y.com' };
    for (let i = 0; i < MAX_DEPTH + 2; i += 1) deep = { d: deep };
    const out = sanitize({
      cyc,
      deep,
      big: 10n,
      sym: Symbol('s@y.com'),
      fn: () => 1,
      buf: Buffer.from('secret'),
      ab: new ArrayBuffer(2),
      date: new Date(0),
      bad: new Date(Number.NaN),
      n: null,
      u: undefined,
      t: true,
    });
    const text = JSON.stringify(out);
    expect(text).toContain('[Circular]');
    expect(text).toContain('[Truncated]');
    expect(text).not.toContain('x@y.com');
    expect(text).not.toContain('s@y.com');
    expect(text).toContain('"big":"10"');
    expect(text).toContain('[Binary 6 bytes]');
    expect(text).toContain('[Function]');
    expect(text).toContain('1970-01-01T00:00:00.000Z');
    expect(text).toContain('Invalid Date');
  });

  it('does not treat shared (non-circular) references as cycles', () => {
    const shared = { v: 1 };
    expect(sanitize({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: { v: 1 } });
  });

  it('survives throwing toJSON, throwing getters and hostile prototypes', () => {
    class Bad {
      toJSON(): never {
        throw new Error('no');
      }
    }
    const getter = {
      get boom(): string {
        throw new Error('no');
      },
    };
    const proto = Object.create({ inherited: 'x' }) as Record<string, unknown>;
    proto['own'] = 1;
    const out = JSON.stringify(sanitize({ bad: new Bad(), getter, proto }));
    expect(out).toContain('[Unserializable]');
    expect(out).toContain('[Unreadable]');
  });

  it('survives a throwing Proxy', () => {
    const p = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    expect(sanitize({ p })).toEqual({ p: '[Unserializable]' });
  });

  it('keeps __proto__ as a plain data key', () => {
    const parsed = JSON.parse('{"__proto__":{"x":1}}') as unknown;
    const out = sanitize(parsed) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.keys(out)).toEqual(['__proto__']);
  });

  it('truncates very long strings (timing is asserted in review.test.ts)', () => {
    const long = 'a'.repeat(MAX_STRING_LENGTH * 20);
    const out = sanitize({ s: long, t: `${'a.'.repeat(50_000)}@` }) as { s: string };
    expect(out.s).toContain('[truncated');
    expect(out.s.length).toBeLessThan(MAX_STRING_LENGTH + 100);
  });

  it('passes harmless scalars through', () => {
    expect(sanitize(5)).toBe(5);
    expect(sanitize('plain')).toBe('plain');
    expect(sanitize(undefined)).toBeUndefined();
  });

  it('lists its fragments in normalised form', () => {
    for (const f of SENSITIVE_KEY_FRAGMENTS) expect(normalizeKey(f)).toBe(f);
  });
});

describe('property: secrets never reach the output', () => {
  const alnum = fc.stringMatching(/^[A-Za-z0-9]{1,8}$/);
  const marker = alnum.map((s) => `SEKRET${s}`);
  const baseKeys = [
    'accessToken',
    'refresh_token',
    'idToken',
    'authorization',
    'x-api-key',
    'password',
    'clientSecret',
    'set-cookie',
    'receipt-data',
    'purchaseToken',
    'signedTransactionInfo',
    'originalJson',
    'email',
    'e-mail',
    'rawBody',
  ];
  const secretKey = fc
    .tuple(
      fc.constantFrom(...baseKeys),
      fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
      fc.constantFrom('', 'user', 'x_', 'my-'),
      fc.constantFrom('', '2', '_v1', 'Value'),
    )
    .map(([base, flips, pre, post]) =>
      `${pre}${base}${post}`
        .split('')
        .map((ch, i) => (flips[i] === true ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    );
  const email = fc
    .tuple(
      fc.stringMatching(/^[a-z0-9]{1,10}$/),
      fc.stringMatching(/^[a-z]{1,10}$/),
      fc.constantFrom('com', 'org', 'io', 'co.uk'),
    )
    .map(([l, d, t]) => `${l}@${d}.${t}`);

  type Step = { readonly kind: 'key'; readonly key: string } | { readonly kind: 'array' };
  const step: fc.Arbitrary<Step> = fc.oneof(
    alnum.map((key): Step => ({ kind: 'key', key })),
    fc.constant<Step>({ kind: 'array' }),
  );

  function wrapIn(steps: readonly Step[], leaf: unknown, noise: unknown): unknown {
    return steps.reduceRight<unknown>((inner, s) => {
      if (s.kind === 'array') return [noise, inner];
      return { noise, [s.key]: inner };
    }, leaf);
  }

  // Noise cannot contain markers or emails by construction: only digits and punctuation-free numbers.
  const noise = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null));

  it('secret keys at any depth, any casing', () => {
    fc.assert(
      fc.property(
        fc.array(step, { maxLength: 6 }),
        secretKey,
        marker,
        noise,
        (steps, key, value, n) => {
          const leafHolder = { [key]: value, ok: n };
          const out = logOnce(wrapIn(steps, leafHolder, n));
          expect(out).not.toContain(value);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('secret values of any shape under a secret key', () => {
    fc.assert(
      fc.property(secretKey, marker, (key, value) => {
        for (const shape of [
          value,
          [value],
          { a: value },
          [{ b: [value] }],
          new Map([['k', value]]),
        ]) {
          expect(logOnce({ [key]: shape })).not.toContain(value);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('email-like strings anywhere (values, keys, messages, errors)', () => {
    fc.assert(
      fc.property(
        fc.array(step, { maxLength: 6 }),
        email,
        fc.constantFrom('', 'mail ', 'x=', '<', '"'),
        fc.constantFrom('', ' end', '>', '.'),
        noise,
        (steps, addr, pre, post, n) => {
          const text = `${pre}${addr}${post}`;
          const asKey = { [text]: n };
          const nested = wrapIn(steps, { text, list: [text], asKey }, n);
          const out = logOnce({ nested, err: new Error(text) }, text);
          expect(out.toLowerCase()).not.toContain(addr);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('arbitrary JSON never breaks the output and never leaks injected secrets', () => {
    fc.assert(
      fc.property(fc.jsonValue(), marker, (json, value) => {
        const out = logOnce({ data: json, password: value, extra: [{ token: value }] }, 'm');
        expect(out).not.toContain(value);
      }),
      { numRuns: 200 },
    );
  });
});
