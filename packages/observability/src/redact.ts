/**
 * Redaction engine. Pure and deterministic. Every value that reaches the log output goes through
 * `sanitize()`; there is no code path from a caller to pino that skips it.
 */

export const REDACTED = '[REDACTED]';
export const CIRCULAR = '[Circular]';
export const TRUNCATED = '[Truncated]';

/** Maximum nesting depth that is inspected; deeper values are replaced by `[Truncated]`. */
export const MAX_DEPTH = 10;

/** Strings longer than this are cut before scanning (bounds CPU on hostile input). */
export const MAX_STRING_LENGTH = 8192;

/**
 * Key fragments. A key is sensitive when its normalised form (NFKC, lower-case, only [a-z0-9]) CONTAINS one of
 * these. So `Access_Token`, `x-api-key`, `ACCESSTOKEN`, `user.E-Mail` and `purchaseToken` all match.
 * Over-redaction (for example `tokenCount`) is intentional: a false positive costs a log field, a false negative
 * costs a breach.
 */
export const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  // tokens and credentials
  'token',
  'bearer',
  'authorization',
  'apikey',
  'accesskey',
  'password',
  'passwd',
  'passphrase',
  'secret',
  'credential',
  'privatekey',
  'cookie',
  'jwt',
  'sessionid',
  'csrf',
  'xsrf',
  'signature',
  // email
  'email',
  // payment receipts (App Store, Play Billing)
  'receipt',
  'signedtransaction',
  'signedrenewal',
  'jws',
  'purchasedata',
  'originaljson',
  // raw payloads and chat
  'rawbody',
  'requestbody',
  'responsebody',
  'rawchat',
  'chatmessage',
];

/** Keys that carry raw user content or whole payloads; matched on the normalised key EXACTLY. */
export const SENSITIVE_EXACT_KEYS: readonly string[] = ['body', 'chat'];

/** Keys that pino or this package own; user data may not overwrite them. */
export const RESERVED_KEYS: readonly string[] = ['level', 'time', 'msg', 'service', 'component'];

export interface RedactionConfig {
  /** Extra key fragments (normalised before matching, contains-match). */
  readonly extraKeys?: readonly string[] | undefined;
  /** Extra value patterns replaced inside strings. Non-global RegExps are made global. */
  readonly extraPatterns?: readonly RegExp[] | undefined;
}

export interface Redactor {
  /** Deep copy of `value` with every secret removed. Never throws. */
  readonly sanitize: (value: unknown) => unknown;
  /** Replace secret-looking substrings in a string. */
  readonly scrubString: (value: string) => string;
  /** Scrub an already serialised JSON line. Only touches characters that cannot break JSON syntax. */
  readonly scrubLine: (line: string) => string;
  readonly isSensitiveKey: (key: string) => boolean;
}

// Quantifiers are bounded so that scanning hostile input stays linear.
const EMAIL =
  /[\p{L}\p{N}._%+-]{1,64}(?:@|%40)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/giu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g;
const KEY_VALUE =
  /([\w.-]{0,40}(?:token|password|passwd|passphrase|secret|api[_-]?key|authorization|cookie|credential|receipt)[\w.-]{0,40}["']?\s*[=:]\s*["']?)([^\s"',;&\\]+)/gi;

/** Normalise a key so that casing, separators and compatibility characters cannot hide it. */
export function normalizeKey(key: string): string {
  return key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function globalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function isPlainContainer(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function createRedactor(config: RedactionConfig = {}): Redactor {
  const fragments = [
    ...SENSITIVE_KEY_FRAGMENTS,
    ...(config.extraKeys ?? []).map(normalizeKey).filter((k) => k.length > 0),
  ];
  const exact = new Set(SENSITIVE_EXACT_KEYS);
  const extra = (config.extraPatterns ?? []).map(globalPattern);

  const isSensitiveKey = (key: string): boolean => {
    const n = normalizeKey(key);
    return exact.has(n) || fragments.some((f) => n.includes(f));
  };

  // Always `.replace` with a fresh regex state: global regexes are shared, `replace` resets lastIndex.
  const scrubLine = (line: string): string =>
    line.replace(EMAIL, REDACTED).replace(BEARER, REDACTED).replace(JWT, REDACTED);

  const scrubString = (value: string): string => {
    let out = scrubLine(value).replace(KEY_VALUE, `$1${REDACTED}`);
    for (const pattern of extra) out = out.replace(pattern, REDACTED);
    return out;
  };

  const safeKey = (key: string): string => {
    const scrubbed = scrubString(key);
    return RESERVED_KEYS.includes(scrubbed) ? `_${scrubbed}` : scrubbed;
  };

  function serializeError(err: Error, depth: number, ancestors: WeakSet<object>): unknown {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    out['type'] = scrubString(err.name);
    out['message'] = scrubString(err.message);
    if (typeof err.stack === 'string') out['stack'] = scrubString(err.stack);
    for (const key of Object.keys(err)) {
      if (key === 'message' || key === 'stack' || key === 'name') continue;
      out[safeKey(key)] = isSensitiveKey(key)
        ? REDACTED
        : walk(readProp(err, key), depth + 1, ancestors);
    }
    if ('cause' in err && !('cause' in out)) {
      out['cause'] = walk(err.cause, depth + 1, ancestors);
    }
    if (err instanceof AggregateError) {
      out['errors'] = walk(err.errors, depth + 1, ancestors);
    }
    return out;
  }

  function readProp(source: object, key: string): unknown {
    try {
      return (source as Record<string, unknown>)[key];
    } catch {
      return '[Unreadable]';
    }
  }

  function walkObject(value: object, depth: number, ancestors: WeakSet<object>): unknown {
    if (value instanceof Error) return serializeError(value, depth, ancestors);
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return `[Binary ${String(value.byteLength)} bytes]`;
    }
    if (value instanceof Map) {
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [k, v] of value) {
        const key = typeof k === 'string' ? k : String(walk(k, depth + 1, ancestors));
        out[safeKey(key)] = isSensitiveKey(key) ? REDACTED : walk(v, depth + 1, ancestors);
      }
      return out;
    }
    if (value instanceof Set) return walk([...value], depth, ancestors);
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, ancestors));

    if (!isPlainContainer(value)) {
      // Class instances may define toJSON (pino/JSON.stringify would call it): sanitise its result instead.
      const toJSON = readProp(value, 'toJSON');
      if (typeof toJSON === 'function') {
        try {
          return walk((toJSON as () => unknown).call(value), depth + 1, ancestors);
        } catch {
          return '[Unserializable]';
        }
      }
    }
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      out[safeKey(key)] = isSensitiveKey(key)
        ? REDACTED
        : walk(readProp(value, key), depth + 1, ancestors);
    }
    return out;
  }

  function walk(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
    switch (typeof value) {
      case 'string':
        return value.length > MAX_STRING_LENGTH
          ? `${scrubString(value.slice(0, MAX_STRING_LENGTH))}...[truncated ${String(value.length - MAX_STRING_LENGTH)} chars]`
          : scrubString(value);
      case 'number':
      case 'boolean':
      case 'undefined':
        return value;
      case 'bigint':
        return value.toString();
      case 'symbol':
        return scrubString(value.toString());
      case 'function':
        return '[Function]';
      case 'object': {
        if (value === null) return null;
        if (ancestors.has(value)) return CIRCULAR;
        if (depth >= MAX_DEPTH) return TRUNCATED;
        ancestors.add(value);
        try {
          return walkObject(value, depth, ancestors);
        } catch {
          return '[Unserializable]';
        } finally {
          ancestors.delete(value);
        }
      }
    }
  }

  return {
    sanitize: (value) => walk(value, 0, new WeakSet<object>()),
    scrubString,
    scrubLine,
    isSensitiveKey,
  };
}
