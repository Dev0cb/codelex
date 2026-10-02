import { createRedactor, RESERVED_KEYS, type RedactionConfig, type Redactor } from './redact.js';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LoggerLevel = LogLevel | 'silent';

/** Anything with a synchronous `write(line)`: `process.stdout`, a file stream, a test buffer. */
export interface LogDestination {
  write(line: string): unknown;
}

/** Structured fields of one log line. `traceId` / `spanId` are reserved for OpenTelemetry correlation. */
export interface LogFields {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly [key: string]: unknown;
}

export interface LoggerOptions {
  /** Service name, e.g. `gateway`. Added to every line as `service`. */
  readonly service: string;
  /** Optional sub-component, e.g. `ws-edge`. Added to every line as `component`. */
  readonly component?: string;
  /** Default `info`. `debug` must be off in prod. `silent` disables output. */
  readonly level?: LoggerLevel;
  /** Default `process.stdout`. Written synchronously, one `\n`-terminated JSON line per call. */
  readonly destination?: LogDestination;
  /** Extra redaction rules, on top of (never instead of) the built-in ones. */
  readonly redact?: RedactionConfig;
}

export type LogMethod = {
  (fields: LogFields | Error, message?: string): void;
  (message: string): void;
};

export interface Logger {
  readonly error: LogMethod;
  readonly warn: LogMethod;
  readonly info: LogMethod;
  readonly debug: LogMethod;
  /** New logger with extra bindings (sanitised like any field). */
  child(bindings: LogFields): Logger;
  readonly level: LoggerLevel;
  /** False for unknown levels. */
  isLevelEnabled(level: LogLevel): boolean;
  /** Writes are synchronous, so this is a no-op today; call it before process exit so a buffered sink works later. */
  flush(): void;
}

/** A line longer than this is replaced by the envelope, `truncated: true` and the message. */
export const MAX_LINE_LENGTH = 32_768;

const RANK: Readonly<Record<LoggerLevel, number>> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};
const LEVEL_SET: ReadonlySet<string> = new Set<string>(Object.keys(RANK));
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Narrow an untrusted string (for example `process.env.LOG_LEVEL`) to a level; throws on anything else. */
export function parseLevel(value: unknown): LoggerLevel {
  if (typeof value === 'string' && LEVEL_SET.has(value)) return value as LoggerLevel;
  throw new TypeError(
    `Invalid log level: expected one of ${[...LEVEL_SET].join(', ')}, got ${typeof value === 'string' ? JSON.stringify(value) : typeof value}`,
  );
}

function assertName(label: string, value: unknown): string {
  if (typeof value !== 'string' || !NAME.test(value)) {
    throw new TypeError(`Invalid ${label}: expected lower-case [a-z0-9._-], 1-64 chars`);
  }
  return value;
}

type Rec = Record<string, unknown>;
const newRec = (): Rec => Object.create(null) as Rec;

/** Sanitised fields as an own-property map: never a plain object, so `toString` etc. are ordinary keys. */
function toFields(redactor: Redactor, value: unknown): Rec {
  const clean = redactor.sanitize(value);
  if (typeof clean === 'object' && clean !== null && !Array.isArray(clean)) return clean as Rec;
  const out = newRec();
  out['value'] = clean;
  return out;
}

function merge(target: Rec, source: Rec): void {
  for (const key of Object.keys(source)) {
    target[RESERVED_KEYS.includes(key) ? `_${key}` : key] = source[key];
  }
}

function messageText(redactor: Redactor, message: unknown): string | undefined {
  if (message === undefined) return undefined;
  if (typeof message === 'string') return redactor.scrubString(message);
  const clean = redactor.sanitize(message);
  if (typeof clean === 'string') return clean;
  const json = JSON.stringify(clean) as string | undefined;
  return json ?? String(clean);
}

/** JSON.stringify output is valid JSON, but U+2028/2029 break naive line splitters: escape them. */
function serialize(record: Rec): string {
  return `${JSON.stringify(record)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}\n`;
}

interface Core {
  readonly service: string;
  readonly component: string | undefined;
  readonly rank: number;
  readonly levelName: LoggerLevel;
  readonly sink: LogDestination;
  readonly redactor: Redactor;
}

function build(core: Core, bindings: Rec | undefined): Logger {
  const emit = (level: LogLevel, first: unknown, message: unknown): void => {
    let line: string;
    try {
      const fields = first instanceof Error ? { err: first } : first;
      const record = newRec();
      record['level'] = level;
      record['time'] = new Date().toISOString();
      record['service'] = core.service;
      if (core.component !== undefined) record['component'] = core.component;
      const msg = messageText(core.redactor, message);
      if (bindings !== undefined) merge(record, bindings);
      if (fields !== undefined) merge(record, toFields(core.redactor, fields));
      if (msg !== undefined) record['msg'] = msg;
      line = serialize(record);
      if (line.length > MAX_LINE_LENGTH) {
        const slim = newRec();
        slim['level'] = level;
        slim['time'] = record['time'];
        slim['service'] = core.service;
        if (core.component !== undefined) slim['component'] = core.component;
        slim['truncated'] = true;
        if (msg !== undefined) slim['msg'] = msg;
        line = serialize(slim);
      }
    } catch {
      line = `{"level":"${level}","service":${JSON.stringify(core.service)},"msg":"log_failed"}\n`;
    }
    try {
      core.sink.write(line);
    } catch {
      // A broken sink (EPIPE, closed stream) must never take the caller down.
    }
  };

  const make =
    (level: LogLevel): LogMethod =>
    (first: unknown, message?: unknown): void => {
      if (RANK[level] > core.rank) return;
      if (typeof first === 'string') {
        emit(level, undefined, first);
        return;
      }
      emit(level, first, message);
    };

  return {
    error: make('error'),
    warn: make('warn'),
    info: make('info'),
    debug: make('debug'),
    child: (extra) => {
      const merged = newRec();
      if (bindings !== undefined) merge(merged, bindings);
      try {
        merge(merged, toFields(core.redactor, extra));
      } catch {
        merged['bindings'] = '[Unserializable]';
      }
      return build(core, merged);
    },
    level: core.levelName,
    isLevelEnabled: (level) =>
      LEVEL_SET.has(level) && (level as string) !== 'silent' && RANK[level] <= core.rank,
    flush: () => undefined,
  };
}

/**
 * Create the service logger: one JSON line per call (`level`, `time`, `service`, `component`, bindings,
 * fields, `msg`), with mandatory redaction of tokens, emails, receipts, PII identifiers and raw bodies
 * (see README). Records are built and serialised here with `JSON.stringify`, never by a third-party
 * serializer. Logging never throws. Throws `TypeError` on invalid options: a mis-configured logger must
 * fail at start-up, not at 3 a.m.
 */
export function createLogger(options: LoggerOptions): Logger {
  const service = assertName('service', options.service);
  const component =
    options.component === undefined ? undefined : assertName('component', options.component);
  const levelName = parseLevel(options.level ?? 'info');
  const sink = options.destination ?? process.stdout;
  if (typeof (sink as { write?: unknown }).write !== 'function') {
    throw new TypeError('Invalid destination: expected an object with a write(line) method');
  }
  return build(
    {
      service,
      component,
      rank: RANK[levelName],
      levelName,
      sink,
      redactor: createRedactor(options.redact),
    },
    undefined,
  );
}
