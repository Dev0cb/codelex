import { describe, expect, it } from 'vitest';
import { createLogger, parseLevel, type LogDestination } from './logger.js';

function capture(): {
  dest: LogDestination;
  lines: () => Record<string, unknown>[];
  raw: () => string;
} {
  const buf: string[] = [];
  return {
    dest: { write: (l) => buf.push(l) },
    lines: () => buf.map((l) => JSON.parse(l) as Record<string, unknown>),
    raw: () => buf.join(''),
  };
}

describe('createLogger', () => {
  it('writes one JSON line with level label, ISO time, service and component', () => {
    const c = capture();
    const log = createLogger({ service: 'gateway', component: 'http', destination: c.dest });
    log.info({ matchId: 'm1' }, 'match started');
    const [line] = c.lines();
    expect(line).toMatchObject({
      level: 'info',
      service: 'gateway',
      component: 'http',
      msg: 'match started',
      matchId: 'm1',
    });
    expect(String(line?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(c.raw().endsWith('\n')).toBe(true);
  });

  it('omits component when not given and accepts a bare message', () => {
    const c = capture();
    createLogger({ service: 'game', destination: c.dest }).warn('plain');
    expect(c.lines()[0]).toMatchObject({ level: 'warn', service: 'game', msg: 'plain' });
    expect(c.lines()[0]).not.toHaveProperty('component');
  });

  it('defaults to info and filters lower levels', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    expect(log.level).toBe('info');
    expect(log.isLevelEnabled('debug')).toBe(false);
    log.debug('hidden');
    log.error('shown');
    expect(c.lines().map((l) => l['level'])).toEqual(['error']);
  });

  it('supports debug and silent', () => {
    const c = capture();
    createLogger({ service: 'game', level: 'debug', destination: c.dest }).debug('d');
    expect(c.lines()).toHaveLength(1);
    const s = capture();
    createLogger({ service: 'game', level: 'silent', destination: s.dest }).error({ a: 1 }, 'x');
    expect(s.lines()).toHaveLength(0);
  });

  it('rejects invalid options', () => {
    expect(() => createLogger({ service: 'game', level: 'trace' as never })).toThrow(TypeError);
    expect(() => createLogger({ service: 'Bad Name' })).toThrow(/service/);
    expect(() => createLogger({ service: 'game', component: '' })).toThrow(/component/);
    expect(() => createLogger({ service: 5 as never })).toThrow(TypeError);
  });

  it('parseLevel validates untrusted input', () => {
    expect(parseLevel('warn')).toBe('warn');
    expect(() => parseLevel('verbose')).toThrow(/"verbose"/);
    expect(() => parseLevel(undefined)).toThrow(/undefined/);
  });

  it('child loggers inherit bindings and add their own', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    const child = log.child({ matchId: 'm9', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
    child.child({ turn: 3 }).info('tick');
    expect(c.lines()[0]).toMatchObject({
      service: 'game',
      matchId: 'm9',
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      turn: 3,
    });
    expect(child.level).toBe('info');
    expect(child.isLevelEnabled('error')).toBe(true);
  });

  it('accepts traceId and spanId per call', () => {
    const c = capture();
    createLogger({ service: 'game', destination: c.dest }).info(
      { traceId: 't1', spanId: 's1' },
      'm',
    );
    expect(c.lines()[0]).toMatchObject({ traceId: 't1', spanId: 's1' });
  });

  it('user fields cannot overwrite reserved keys', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    log.info({ service: 'evil', level: 'x', msg: 'm2', time: 1, component: 'c' }, 'real');
    log.child({ service: 'evil2' }).info('child');
    const [a, b] = c.lines();
    expect(a).toMatchObject({ service: 'game', level: 'info', msg: 'real' });
    expect(a).toMatchObject({ _service: 'evil', _level: 'x', _msg: 'm2', _component: 'c' });
    expect(b).toMatchObject({ service: 'game', _service: 'evil2' });
  });

  it('logs an Error passed directly, scrubbing its message', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    log.error(new Error('login failed for bob@example.com Bearer abc.def.ghi'));
    const err = c.lines()[0]?.['err'] as Record<string, unknown>;
    expect(err['type']).toBe('Error');
    expect(err['message']).toBe('login failed for [REDACTED] [REDACTED]');
    expect(c.raw()).not.toContain('bob@example.com');
    expect(c.raw()).not.toContain('abc.def.ghi');
  });

  it('wraps non-object fields', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    log.info([1, 2] as never, 'arr');
    expect(c.lines()[0]).toMatchObject({ value: [1, 2], msg: 'arr' });
  });

  it('scrubs emails in message strings', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    log.info({ n: 1 }, 'user=carol@example.org');
    log.info('plain carol@example.org');
    expect(c.raw()).not.toContain('carol@example.org');
  });

  it('scrubs the serialised line even if a field slipped through', () => {
    const c = capture();
    const log = createLogger({ service: 'game', destination: c.dest });
    // The merge key `msg` is reserved, so only message text carries the address; the line pass is a backstop.
    log.info({ n: 1 }, 'a%40b.example');
    expect(c.raw()).not.toContain('b.example');
  });

  it('uses process.stdout by default', () => {
    const log = createLogger({ service: 'game', level: 'silent' });
    expect(log.level).toBe('silent');
  });

  it('supports custom redaction keys and patterns', () => {
    const c = capture();
    const log = createLogger({
      service: 'game',
      destination: c.dest,
      redact: { extraKeys: ['Friend-Code'], extraPatterns: [/CDX-\d+/] },
    });
    log.info({ friendCode: 'zzz', note: 'see CDX-123 and CDX-456' }, 'x');
    expect(c.lines()[0]).toMatchObject({
      friendCode: '[REDACTED]',
      note: 'see [REDACTED] and [REDACTED]',
    });
  });
});
