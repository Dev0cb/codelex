import { pino, stdTimeFunctions, type Logger as PinoLogger } from 'pino';
import { createRedactor, type RedactionConfig, type Redactor } from './redact.js';

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
  /** Default `process.stdout`. Wrapped: the redactor also scrubs the serialised line. */
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
  isLevelEnabled(level: LogLevel): boolean;
}

const LEVEL_SET: ReadonlySet<string> = new Set<string>([...LOG_LEVELS, 'silent']);
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

function toFields(redactor: Redactor, value: unknown): Record<string, unknown> {
  const clean = redactor.sanitize(value);
  if (typeof clean === 'object' && clean !== null && !Array.isArray(clean)) {
    return { ...(clean as Record<string, unknown>) };
  }
  return { value: clean };
}

function wrap(pinoLogger: PinoLogger, redactor: Redactor): Logger {
  const make =
    (level: LogLevel): LogMethod =>
    (first: LogFields | Error | string, message?: string): void => {
      if (!pinoLogger.isLevelEnabled(level)) return;
      if (typeof first === 'string') {
        pinoLogger[level](redactor.scrubString(first));
        return;
      }
      const fields = first instanceof Error ? { err: first } : first;
      const msg = message === undefined ? undefined : redactor.scrubString(message);
      pinoLogger[level](toFields(redactor, fields), msg);
    };

  return {
    error: make('error'),
    warn: make('warn'),
    info: make('info'),
    debug: make('debug'),
    child: (bindings) => wrap(pinoLogger.child(toFields(redactor, bindings)), redactor),
    get level(): LoggerLevel {
      return pinoLogger.level as LoggerLevel;
    },
    isLevelEnabled: (level) => pinoLogger.isLevelEnabled(level),
  };
}

/**
 * Create the service logger: pino JSON lines, ISO timestamps, string level labels, `service` / `component`
 * bindings, and mandatory redaction of tokens, emails, receipts and raw bodies (see README).
 * Throws `TypeError` on invalid options: a mis-configured logger must fail at start-up, not at 3 a.m.
 */
export function createLogger(options: LoggerOptions): Logger {
  const service = assertName('service', options.service);
  const component =
    options.component === undefined ? undefined : assertName('component', options.component);
  const level = parseLevel(options.level ?? 'info');
  const redactor = createRedactor(options.redact);
  const sink = options.destination ?? process.stdout;

  const pinoLogger = pino(
    {
      level,
      base: component === undefined ? { service } : { service, component },
      timestamp: stdTimeFunctions.isoTime,
      messageKey: 'msg',
      // Errors are already serialised (and scrubbed) by the redactor; pino's default err serializer would redo it.
      serializers: { err: (value: unknown) => value },
      formatters: { level: (label) => ({ level: label }) },
    },
    { write: (line: string) => sink.write(redactor.scrubLine(line)) },
  );
  return wrap(pinoLogger, redactor);
}
