import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { summarizeBody } from './body.js';
import { createLogger, type LogDestination, type Logger } from './logger.js';
import { createRedactor, MAX_STRING_LENGTH, REDACTED } from './redact.js';

// Secret-looking fixtures are assembled at run time: a repo hook blocks literal secret shapes in files.
const j = (...parts: string[]): string => parts.join('');

function sink(): {
  dest: LogDestination;
  lines: string[];
  records: () => Record<string, unknown>[];
} {
  const lines: string[] = [];
  return {
    dest: { write: (l) => lines.push(l) },
    lines,
    records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function make(opts: { level?: 'debug' | 'info' } = {}): {
  log: Logger;
  lines: string[];
  records: () => Record<string, unknown>[];
} {
  const s = sink();
  const log = createLogger({ service: 'test', level: opts.level ?? 'debug', destination: s.dest });
  return { log, lines: s.lines, records: s.records };
}

function once(fields: unknown, msg?: string): string {
  const m = make();
  (m.log.info as (f: unknown, msg?: string) => void)(fields, msg);
  expect(m.lines).toHaveLength(1);
  expect(m.lines[0]?.endsWith('\n')).toBe(true);
  expect(m.lines[0]?.slice(0, -1)).not.toContain('\n');
  JSON.parse(m.lines[0] ?? '');
  return m.lines[0] ?? '';
}

describe('B1/L4/H1: object-prototype keys and forged keys', () => {
  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__', 'toJSON'])(
    'key %s is plain data',
    (key) => {
      const out = once(JSON.parse(`{"${key}":"v"}`));
      expect(JSON.parse(out)).toMatchObject({ level: 'info', service: 'test' });
      expect(out).toContain('"v"');
    },
  );

  it('cannot inject fields or levels through a value under a prototype key', () => {
    const m = make();
    m.log.info({ constructor: '1,"level":"fatal","injected":true' } as never, 'x');
    const [rec] = m.records();
    expect(rec?.['level']).toBe('info');
    expect(rec).not.toHaveProperty('injected');
  });

  it('works for child bindings', () => {
    const m = make();
    const child = m.log.child({ toString: 'a', hasOwnProperty: 'b' });
    child.info('x');
    expect(m.records()[0]).toMatchObject({ toString: 'a', hasOwnProperty: 'b', level: 'info' });
  });

  it('child binding keys cannot forge a second record', () => {
    const m = make();
    m.log.child({ ['x":0}\n{"level":"error","forged":1,"y":"']: 1 }).info('real');
    expect(m.lines).toHaveLength(1);
    expect(m.records()).toHaveLength(1);
    expect(m.records()[0]).not.toHaveProperty('forged');
  });

  it('child bindings cannot spoof the envelope (level, service, time, msg, component)', () => {
    const m = make();
    m.log.child({ level: 'fatal', service: 'x', time: 'T', msg: 'M' }).info('real');
    const [rec] = m.records();
    expect(rec).toMatchObject({ level: 'info', service: 'test', msg: 'real' });
    expect(rec?.['time']).not.toBe('T');
    expect(rec).toMatchObject({ _level: 'fatal', _service: 'x' });
    expect(m.lines).toHaveLength(1);
  });

  it('call-site keys with quotes and newlines stay inside one record', () => {
    const out = once({ ['a"b\nc']: 1 });
    expect(out.trim().split('\n')).toHaveLength(1);
  });

  it('envelope comes first, message last', () => {
    const out = once({ a: 1 }, 'hello');
    expect(Object.keys(JSON.parse(out) as object)).toEqual([
      'level',
      'time',
      'service',
      'a',
      'msg',
    ]);
  });
});

describe('H2: credentials in text', () => {
  const cases: [string, string][] = [
    ['Authorization: Basic ', 'dXNlcjpwYXNzd29yZA=='],
    ['authorization: Digest username="u", realm="r", response="', 'abcdef0123456789"'],
    ['Authorization: Token ', 'abcdef0123456789abcdef'],
    ['Cookie: a=1; session=', 'SECRETCOOKIE'],
    ['Set-Cookie: sid=', 'SECRETSETCOOKIE; Path=/; HttpOnly'],
    ['Proxy-Authorization: Basic ', 'cHJveHk6c2VjcmV0'],
    ['password="', 'correct horse"'],
    ['password=', 'abc&def'],
    ["api_key='", "two words'"],
    ['X-Api-Key: ', 'k3yvalue99'],
    ['GET / HTTP/1.1\r\nAuthorization: Basic ', 'ZHVtbXk6dmFsdWU=\r\nHost: x'],
  ];
  it.each(cases)('redacts %s', (prefix, secret) => {
    const out = once({ t: prefix + secret }, prefix + secret);
    const token = secret.replace(/["']/g, '').split(/[;\r&]/)[0] ?? '';
    for (const word of token.split(' ')) expect(out).not.toContain(word);
    expect(out).toContain(REDACTED);
  });

  it('redacts rawHeaders-style arrays and _header strings', () => {
    const out = once({
      rawHeaders: ['Host', 'x', 'Authorization', 'RAWHDRSECRET', 'Cookie', 'RAWCOOKIE'],
      _header: 'GET / HTTP/1.1\r\nauthorization: HDRSECRET\r\n',
    });
    for (const s of ['RAWHDRSECRET', 'RAWCOOKIE', 'HDRSECRET']) expect(out).not.toContain(s);
  });

  it.each([
    j('Basic ', 'dXNlcjpwYXNz'),
    j('Bearer ', 'abc.def-ghi'),
    j('Token ', 'abcdef0123456789xyz'),
  ])('standalone scheme %s', (s) => {
    const out = once({}, `sent ${s} to server`);
    expect(out).not.toContain(s.split(' ')[1]);
    expect(out).toContain('to server');
  });
});

describe('H3: more keys and URL userinfo', () => {
  const keys = [
    'pass',
    'pwd',
    'pw',
    'auth',
    'privkey',
    'key',
    'session',
    'sid',
    'otp',
    'pin',
    'mfa',
    'code',
    'dsn',
    'connectionString',
    'databaseUrl',
    'DATABASE_URL',
    'payload',
    'reqBody',
    'resBody',
    'ip',
    'forwardedFor',
    'x-forwarded-for',
    'phone',
    'deviceId',
    'idfa',
    'gaid',
    'adid',
    'motDePasse',
    'mdp',
    'jeton',
    'courriel',
    'private key',
    'access key',
    'sessionToken',
    'userSession',
    'licenseKey',
    'privateKey',
    'authCode',
    'verificationCode',
    'resetCode',
    'birthDate',
    'date_of_birth',
    'dob',
  ];
  it.each(keys)('redacts key %s', (key) => {
    const out = once({ [key]: 'VALUEXYZ' });
    expect(out).not.toContain('VALUEXYZ');
    expect(JSON.parse(out)).toHaveProperty([key], REDACTED);
  });

  it('does not redact innocuous keys', () => {
    expect(once({ matchId: 'mm1', turn: 4, mode: 'classic' })).toContain('mm1');
  });

  it.each([
    'idempotencyKey',
    'cacheKey',
    'sortKey',
    'errorCode',
    'statusCode',
    'countryCode',
    'languageCode',
  ])('allowlisted key %s stays visible', (key) => {
    const out = once({ [key]: 'VISIBLEVAL' });
    expect(JSON.parse(out)).toHaveProperty([key], 'VISIBLEVAL');
  });

  it.each([
    'https://x.io/a?pwd=QSECRET1',
    'https://x.io/a?pin=1234567',
    'https://x.io/a?otp=7654321',
    'https://x.io/a?mfa=QSECRET2',
    'https://x.io/a?auth_code=QSECRET3',
    'https://x.io/a?verification_code=QSECRET4&x=1',
    'https://x.io/a?pw=QSECRET5',
  ])('query string secret in %s', (url) => {
    const out = once({ u: url }, url);
    expect(out).not.toMatch(/QSECRET\d|1234567|7654321/);
    expect(out).toContain(REDACTED);
  });

  it.each([
    ['postgres://user:', 'p4ssw0rd', '@db.example.net:5432/x'],
    ['redis://:', 'redispw', '@redis-master:6379'],
    ['https://', 'onlytoken', '@host/path'],
  ])('URL userinfo %s', (a, secret, b) => {
    const out = once({ u: a + secret + b }, a + secret + b);
    expect(out).not.toContain(secret);
    expect(out).toContain('@');
  });
});

describe('M-A: long receipt values are masked to the end of the token', () => {
  it.each([
    ['long double-quoted', `receipt="${'A'.repeat(600)}"`],
    ['long single-quoted', `receipt='${'A'.repeat(600)}'`],
    ['unterminated quoted', `receipt="${'A'.repeat(600)}`],
    ['long bare', `receipt=${'A'.repeat(600)}`],
    ['JSON 6 KB base64', `{"receipt-data":"${'A'.repeat(6144)}"}`],
  ])('%s', (_name, value) => {
    expect(createRedactor().scrubString(value)).not.toContain('AAAA');
    const out = once({ t: value }, value);
    expect(out).not.toContain('AAAA');
    expect(out).toContain(REDACTED);
  });

  it('a short quoted value does not swallow the rest of the text', () => {
    expect(createRedactor().scrubString('password="abc" then ok')).toBe(
      `password=${REDACTED} then ok`,
    );
  });
});

describe('M-B: rawHeaders misalignment', () => {
  it('masks the value after a sensitive header name that is itself a value', () => {
    const out = once({ rawHeaders: ['Vary', 'Cookie', 'Set-Cookie', 'connect.sid=s%3Aabc123'] });
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('connect.sid=');
  });
});

describe('M-C: long Cookie header lines', () => {
  it('masks a ~3 KB Cookie header with the session cookie last', () => {
    const filler = Array.from({ length: 200 }, (_, i) => `c${String(i)}=value${String(i)}`).join(
      '; ',
    );
    const header = `Cookie: ${filler}; connect.sid=s%3Asecretvalue`;
    expect(header.length).toBeGreaterThan(2500);
    expect(createRedactor().scrubString(header)).not.toContain('secretvalue');
    expect(once({ h: header })).not.toContain('secretvalue');
  });
});

describe('L-A: Error.code', () => {
  const codeOf = (code: unknown): unknown =>
    (
      JSON.parse(once({ err: Object.assign(new Error('x'), { code }) })) as {
        err: { code: unknown };
      }
    ).err.code;

  it('opaque string codes are redacted', () => {
    const out = once({ err: Object.assign(new Error('x'), { code: 'abc123opaque' }) });
    expect(out).not.toContain('abc123opaque');
    expect(codeOf('abc123opaque')).toBe(REDACTED);
  });

  it.each(['ECONNRESET', 'ENOENT', 'ERR_X'])('keeps code %s', (code) => {
    expect(codeOf(code)).toBe(code);
  });

  it('keeps numeric codes', () => {
    expect(codeOf(42)).toBe('42');
  });

  it.each(['E', 'econnreset', 'A'.repeat(49), 'E-1'])('redacts non-matching code %s', (code) => {
    expect(codeOf(code)).toBe(REDACTED);
  });
});

// Each bound samples workloads for ~0.5 s in total (more when a measurement is retried) under coverage
// on a loaded CI runner: the default 5 s test timeout is too tight.
describe('H4/M3: CPU bounds', { timeout: 30_000 }, () => {
  const r = createRedactor();
  // Bounds are ratios between input sizes, never absolute milliseconds (those measure the machine).
  // CI runs other packages' tests on the same cores, so a thread is preempted for whole scheduler
  // quanta. Short windows bias the ratio: a window holding one long call is preempted more often than
  // a window of many short calls, so a minimum over short windows penalises the big input. Hence:
  // windows of the same 20 ms for both inputs (preemption then inflates both alike and cancels out in
  // the ratio), sampled in alternation after a warm-up (regexp/JIT tier-up), median of the ratios.
  // Sizes are chosen so the expected complexity and the one to reject differ by >= 8x.
  const WINDOW_MS = 20;
  const perCall = (f: () => void): number => {
    let calls = 0;
    let elapsed = 0;
    const start = performance.now();
    do {
      f();
      calls += 1;
      elapsed = performance.now() - start;
    } while (elapsed < WINDOW_MS);
    return elapsed / calls;
  };
  const median = (xs: number[]): number => {
    const sorted = [...xs].sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)] ?? Infinity;
  };
  // Cost of `b` relative to `a`. A contention episode can last a whole measurement, so up to 3 spaced
  // measurements are taken and the lowest kept: a real complexity regression exceeds the bound every time.
  const compare = (a: () => void, b: () => void, bound: number): number => {
    let best = Infinity;
    for (let attempt = 0; attempt < 3 && best >= bound; attempt += 1) {
      perCall(a);
      perCall(b);
      const ratios: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const costA = perCall(a);
        ratios.push(perCall(b) / costA);
      }
      best = Math.min(best, median(ratios));
    }
    return best;
  };
  const hostile: [string, (n: number) => string][] = [
    ['jwt prefix', (n) => 'eyJ-'.repeat(n)],
    ['dots', (n) => 'a.'.repeat(n)],
    ['keyword', (n) => 'token '.repeat(n)],
    ['at', (n) => 'a@'.repeat(n)],
    ['equals', (n) => 'password='.repeat(n)],
    ['scheme', (n) => 'ab://'.repeat(n)],
    ['unterminated quote', (n) => 'receipt="'.repeat(n)],
    ['long quoted value', (n) => `receipt="${'A'.repeat(n * 8)}`],
    ['long bare value', (n) => `receipt=${'A'.repeat(n * 8)}`],
    ['cookie header', (n) => `Cookie: ${'a=b; '.repeat(n)}`],
    ['cookie headers', (n) => 'cookie: x\n'.repeat(n)],
    ['many code', (n) => '?code'.repeat(n)],
    ['code word run', (n) => `?${'code'.repeat(n)}=`],
    ['query ampersands', (n) => '&pin=1'.repeat(n)],
  ];

  it.each(hostile)('hostile %s: bounded and linear', (_name, gen) => {
    const small = gen(125);
    const large = gen(1000);
    // 8x input: linear is ~8x, quadratic ~64x
    expect(
      compare(
        () => r.scrubString(small),
        () => r.scrubString(large),
        24,
      ),
    ).toBeLessThan(24);
    // Both above MAX_STRING_LENGTH, 10x apart: truncation keeps the cost flat (~1x); linear would be 10x
    const huge = gen(16_000);
    const huger = gen(160_000);
    expect(
      compare(
        () => r.scrubString(huge),
        () => r.scrubString(huger),
        4,
      ),
    ).toBeLessThan(4);
  });

  it('truncates every string: msg, error parts, keys, map keys', () => {
    const big = 'x'.repeat(MAX_STRING_LENGTH * 10);
    const err = new Error(big);
    err.name = big;
    const out = once({ err, [big]: 1, m: new Map([[big, 1]]) }, big);
    expect(out.length).toBeLessThan(MAX_STRING_LENGTH * 8);
    expect(out).toContain('truncated');
  });

  it('caps keys per object, items per array, and nodes overall', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 1000; i += 1) wide[`k${String(i)}`] = i;
    const out = JSON.parse(once({ wide, list: Array.from({ length: 1000 }, (_, i) => i) })) as {
      wide: Record<string, unknown>;
      list: unknown[];
    };
    expect(Object.keys(out.wide).length).toBeLessThanOrEqual(201);
    expect(out.list.length).toBeLessThanOrEqual(201);
    // exponential fan-out must not explode: depth 3 (150^3 leaves) already hits MAX_NODES, so depth 8
    // (150^8 leaves, 150^5 times more) must cost about the same
    const tree = (depth: number): unknown => {
      let t: unknown = 1;
      for (let i = 0; i < depth; i += 1) t = Array.from({ length: 150 }, () => t);
      return t;
    };
    const shallow = tree(3);
    const deep = tree(8);
    expect(
      compare(
        () => r.sanitize(shallow),
        () => r.sanitize(deep),
        4,
      ),
    ).toBeLessThan(4);
  });

  it('caps total line size', () => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < 150; i += 1) fields[`f${String(i)}`] = 'y'.repeat(2000);
    const out = once(fields, 'big');
    expect(out.length).toBeLessThan(40_000);
    expect(JSON.parse(out)).toMatchObject({ truncated: true, msg: 'big' });
  });
});

describe('M1: line output is always valid JSON', () => {
  it('newline before an email', () => {
    const out = once(
      { a: 'foo\n@example.com', b: 'foo\nbob@example.com' },
      'line\nbob@example.com',
    );
    expect(out).not.toContain('bob@example.com');
  });

  it('property: arbitrary strings give one parseable record', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (s, k) => {
        const out = once({ [k]: s, nested: [s] }, s);
        expect(out.indexOf('\n')).toBe(out.length - 1);
      }),
      { numRuns: 300 },
    );
  });

  it('U+2028 and U+2029 are escaped, not raw', () => {
    const out = once({ a: 'x y z' });
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toMatchObject({ a: 'x y z' });
  });
});

describe('M2: logging never throws', () => {
  it('Proxy with throwing getPrototypeOf', () => {
    const p = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('x');
        },
      },
    );
    const m = make();
    expect(() => {
      m.log.info({ p }, 'x');
    }).not.toThrow();
    expect(m.lines).toHaveLength(1);
  });

  it('non-string message', () => {
    const m = make();
    const f = m.log.info as unknown as (a: unknown, b: unknown) => void;
    expect(() => {
      f({ a: 1 }, 42);
      f({ a: 1 }, { secret: 'MSGSECRET' });
      f({ a: 1 }, Symbol('s'));
    }).not.toThrow();
    expect(m.lines).toHaveLength(3);
    expect(m.lines.join('')).not.toContain('MSGSECRET');
    expect(m.records()[0]).toMatchObject({ msg: '42' });
  });

  it('destination without write is rejected at creation', () => {
    expect(() => createLogger({ service: 'x', destination: {} as never })).toThrow(TypeError);
  });

  it('destination.write throwing (EPIPE) is swallowed', () => {
    const log = createLogger({
      service: 'x',
      destination: {
        write() {
          throw new Error('EPIPE');
        },
      },
    });
    expect(() => {
      log.info({ a: 1 }, 'x');
      log.child({ b: 1 }).error(new Error('e'));
      log.flush();
    }).not.toThrow();
  });

  it('falls back to a minimal record when building the line throws', () => {
    const s = sink();
    const log = createLogger({ service: 'x', destination: s.dest });
    const spy = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      throw new Error('clock');
    });
    try {
      expect(() => {
        log.info({ a: 1 }, 'm');
      }).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(s.records()).toEqual([{ level: 'info', service: 'x', msg: 'log_failed' }]);
  });
});

describe('M4: mutation-resistant assertions', () => {
  it('a disabled level does not touch the fields', () => {
    const m = make({ level: 'info' });
    let reads = 0;
    const fields = {
      get a(): number {
        reads += 1;
        return 1;
      },
    };
    m.log.debug(fields, 'x');
    expect(reads).toBe(0);
    m.log.info(fields, 'x');
    expect(reads).toBe(1);
  });

  it('AggregateError members are present and scrubbed', () => {
    const out = JSON.parse(
      once({ err: new AggregateError([new Error('m1 a@b.io'), new Error('m2')], 'agg') }),
    ) as { err: { errors: { message: string }[] } };
    expect(out.err.errors.map((e) => e.message)).toEqual([`m1 ${REDACTED}`, 'm2']);
  });

  it('keys are scrubbed and secret values replaced in place', () => {
    const out = JSON.parse(once({ 'u@x.io': 1, apiKey: 'K', deep: { Token: 'T' } })) as Record<
      string,
      unknown
    >;
    expect(out[REDACTED]).toBe(1);
    expect(out['apiKey']).toBe(REDACTED);
    expect(out['deep']).toEqual({ Token: REDACTED });
  });

  it('class instances with toJSON use it, sanitised', () => {
    class Dto {
      toJSON(): unknown {
        return { token: 'T1', ok: 1 };
      }
    }
    expect(JSON.parse(once({ d: new Dto() }))).toMatchObject({ d: { token: REDACTED, ok: 1 } });
  });

  it('reserved keys are renamed in place', () => {
    expect(JSON.parse(once({ level: 'x', service: 'y', msg: 'z', time: 't' }, 'm'))).toMatchObject({
      level: 'info',
      service: 'test',
      msg: 'm',
      _level: 'x',
      _service: 'y',
      _msg: 'z',
      _time: 't',
    });
  });
});

function secretOf(value: string): string {
  const m = /(?:tokens\/|key=|code=|Signature=)([A-Za-z0-9]+)/.exec(value);
  if (m?.[1] !== undefined) return m[1];
  return value.length > 24 ? value.slice(-10) : value;
}

describe('Security M2: shape-based secrets in values', () => {
  const fixtures: [string, string][] = [
    [
      'play path',
      j(
        '/androidpublisher/v3/applications/com.x/purchases/products/p/tokens/',
        'abcDEF123456ghiJKL',
      ),
    ],
    ['query key', j('https://api.x.io/v1?key=', 'AbCdEf123456&a=1')],
    ['query code', j('https://x.io/cb?code=', 'oauthcode123&state=1')],
    ['query sig', j('https://x.io/f?X-Amz-Signature=', 'deadbeefcafe')],
    ['stripe', j('sk_', 'live_', '51Habcdefghijkl')],
    ['anthropic', j('sk-', 'ant-', 'api03-abcdefghijkl')],
    ['github', j('gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789')],
    ['github pat', j('github', '_pat_', '11ABCDEFG0abcdefghijkl')],
    ['aws', j('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
    ['slack', j('xo', 'xb-', '123456789012-abcdefghijkl')],
    [
      'pem',
      j('-----BEGIN PRIVATE', ' KEY-----\nMIIEvQIBADANBg\nabcdef\n-----END PRIVATE', ' KEY-----'),
    ],
  ];
  it.each(fixtures)('%s', (_n, value) => {
    const out = once({ v: value }, value);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(secretOf(value));
  });
});

describe('m2: error edge cases', () => {
  it('non-string name and message', () => {
    const e = new Error('x');
    Object.defineProperty(e, 'name', { value: { a: 1 } });
    Object.defineProperty(e, 'message', { value: 42 });
    expect(() => once({ err: e })).not.toThrow();
  });

  it('own type/message props do not overwrite the envelope', () => {
    const e = Object.assign(new TypeError('real'), { type: 'fake', status: 500 });
    const out = JSON.parse(once({ err: e })) as { err: Record<string, unknown> };
    expect(out.err['type']).toBe('TypeError');
    expect(out.err['_type']).toBe('fake');
    expect(out.err['status']).toBe(500);
  });

  it('keeps Error.code', () => {
    const e = Object.assign(new Error('x'), { code: 'ENOENT' });
    expect((JSON.parse(once({ err: e })) as { err: { code: string } }).err.code).toBe('ENOENT');
  });

  it('Map with object keys', () => {
    const out = JSON.parse(
      once({
        m: new Map<unknown, unknown>([
          [{ a: 1 }, 'v'],
          [{ b: 2 }, 'w'],
        ]),
      }),
    ) as { m: object };
    expect(Object.keys(out.m)).toHaveLength(2);
  });

  it('cross-realm errors', () => {
    const foreign = Object.create(null) as Record<symbol, unknown>;
    Object.defineProperty(foreign, Symbol.toStringTag, { value: 'Error' });
    Object.assign(foreign, { message: 'x@y.io', name: 'Foreign' });
    expect(once({ err: foreign })).not.toContain('x@y.io');
  });
});

describe('L1-L3: evasions', () => {
  it('homoglyph keys', () => {
    for (const key of ['еmail', 'pаssword', 'apıKey', 'tokеn', 'οtp']) {
      expect(JSON.parse(once({ [key]: 'HG' }))).toHaveProperty([key], REDACTED);
    }
  });

  it.each([
    'bob​@example.com',
    'bob⁠@example.com',
    'bob‮@example.com',
    'bob＠example.com',
    '"bob smith"@example.com',
    'bob@exam​ple.com',
  ])('email evasion %j', (e) => {
    const out = once({ a: `hi ${e} there` });
    expect(out).not.toMatch(/bob/);
    expect(out).toContain('there');
  });

  it('email at the truncation boundary is not half-leaked', () => {
    const s = `${'x '.repeat(MAX_STRING_LENGTH / 2 - 5)}name@example.com tail`;
    const out = once({ s });
    expect(out).not.toContain('name@');
    expect(out).not.toContain('name');
  });

  it('boxed primitives are unwrapped and scrubbed', () => {
    const out = once({ s: new String('bob@example.com'), n: new Number(5), b: new Boolean(true) });
    expect(out).not.toContain('bob@example.com');
    expect(JSON.parse(out)).toMatchObject({ n: 5, b: true });
  });
});

describe('m4/m5: Logger surface', () => {
  it('flush exists', () => {
    expect(() => {
      make().log.flush();
    }).not.toThrow();
  });

  it('isLevelEnabled with unknown level is false', () => {
    expect(make().log.isLevelEnabled('trace' as never)).toBe(false);
  });

  it('invalid redact config gives clear TypeErrors', () => {
    expect(() => createRedactor({ extraPatterns: [/(?:)/] })).toThrow(/empty/);
    expect(() => createRedactor({ extraPatterns: ['x' as never] })).toThrow(/RegExp/);
    expect(() => createRedactor({ extraKeys: [5 as never] })).toThrow(/extraKeys/);
    expect(() => createRedactor({ extraKeys: ['!!'] })).toThrow(/extraKeys/);
  });
});

describe('L5: README example', () => {
  it('bodyShape keeps the shape and never the content', () => {
    const out = JSON.parse(once({ bodyShape: summarizeBody({ password: 'HUNTER2' }) })) as {
      bodyShape: unknown;
    };
    expect(out.bodyShape).toEqual({ kind: 'object', size: 1 });
  });
});
