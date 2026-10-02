/**
 * Redaction engine. Pure and deterministic. Every value that reaches the log output goes through
 * `sanitize()`; the logger builds the final record from its output only.
 *
 * Output of `sanitize` contains only primitives, arrays and null-prototype plain objects.
 */

export const REDACTED = '[REDACTED]';
export const CIRCULAR = '[Circular]';
export const TRUNCATED = '[Truncated]';

/** Limits (internal tuning knobs, exported for tests and documentation). */
export const MAX_DEPTH = 10;
/** Strings longer than this are cut before output (the scan window is this plus `SCAN_OVERLAP`). */
export const MAX_STRING_LENGTH = 8192;
export const SCAN_OVERLAP = 320;
export const MAX_KEY_LENGTH = 256;
export const MAX_ENTRIES = 200;
/** Total nodes visited per `sanitize` call; bounds fan-out (200 keys x 10 levels would be astronomical). */
export const MAX_NODES = 5000;

/**
 * Key fragments. A key is sensitive when its normalised form CONTAINS one of these (see `normalizeKey`).
 * Over-redaction (`tokenCount`, `author`, `bypass`) is intentional: a false positive costs a log field, a false
 * negative costs a breach. The same list drives the in-text `key=value` rule (fragments of 4+ characters).
 */
export const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  // tokens and credentials
  'token',
  'bearer',
  'authorization',
  'auth',
  'apikey',
  'accesskey',
  'pass', // password, passwd, passphrase, passcode
  'pwd',
  'secret',
  'credential',
  'privatekey',
  'privkey',
  'cookie',
  'jwt',
  'session',
  'csrf',
  'xsrf',
  'signature',
  'birthdate',
  'dateofbirth',
  'connectionstring',
  'databaseurl',
  // French
  'motdepasse',
  'mdp',
  'jeton',
  'courriel',
  // email, network and device identifiers (PII, COPPA)
  'email',
  'forwardedfor',
  'ipaddress',
  'clientip',
  'remoteaddress',
  'phone',
  'deviceid',
  'idfa',
  'gaid',
  'adid',
  // payment receipts (App Store, Play Billing)
  'receipt',
  'signedtransaction',
  'signedrenewal',
  'jws',
  'purchasedata',
  'originaljson',
  // raw payloads and chat
  'payload',
  'rawbody',
  'requestbody',
  'responsebody',
  'reqbody',
  'resbody',
  'rawchat',
  'chatmessage',
];

/** Keys that are sensitive only when they are the whole (normalised) key: too short to contain-match. */
export const SENSITIVE_EXACT_KEYS: readonly string[] = [
  'body',
  'chat',
  'key',
  'code', // OAuth authorization code
  'sid',
  'pw',
  'pin',
  'otp',
  'mfa',
  'dsn',
  'ip',
  'dob',
];

/**
 * Keys ending in `key` or `code` are sensitive (licenseKey, authCode, resetCode) unless they are one of these
 * well-known non-secret names (compared normalised).
 */
export const NON_SENSITIVE_SUFFIX_KEYS: readonly string[] = [
  'idempotencykey',
  'cachekey',
  'sortkey',
  'errorcode',
  'statuscode',
  'countrycode',
  'languagecode',
];

/** Error codes kept verbatim (ECONNRESET, ERR_X); anything else may be an opaque credential. */
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,47}$/;

/** Keys that this package owns; user data may not overwrite them. */
export const RESERVED_KEYS: readonly string[] = ['level', 'time', 'msg', 'service', 'component'];

export interface RedactionConfig {
  /** Extra key fragments (normalised before matching, contains-match). Must contain a letter or digit. */
  readonly extraKeys?: readonly string[] | undefined;
  /** Extra value patterns replaced inside strings. Must not match the empty string. */
  readonly extraPatterns?: readonly RegExp[] | undefined;
}

export interface Redactor {
  /** Deep copy of `value` with every secret removed. Never throws. */
  readonly sanitize: (value: unknown) => unknown;
  /** Replace secret-looking substrings in a string (after cutting it to `MAX_STRING_LENGTH`). */
  readonly scrubString: (value: string) => string;
  readonly isSensitiveKey: (key: string) => boolean;
}

// ---------------------------------------------------------------------------------------------------------
// Key normalisation

const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ӏ: 'l',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  // Latin look-alikes
  ı: 'i',
  ɑ: 'a',
  ɡ: 'g',
  ⅼ: 'l',
};

/**
 * Normalise a key so that casing, separators, accents, compatibility characters and common homoglyphs
 * (Cyrillic, Greek, Turkish dotless i) cannot hide it: NFKD, drop marks, lower-case, confusables to Latin,
 * keep only [a-z0-9].
 */
export function normalizeKey(key: string): string {
  const base = key.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const ch of base) out += CONFUSABLES[ch] ?? ch;
  return out.replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------------------------------------
// Value patterns (all quantifiers bounded; strings are cut to MAX_STRING_LENGTH + SCAN_OVERLAP first)

const INVISIBLE = '\\u00AD\\u200B-\\u200F\\u2060\\u2066-\\u2069\\u202A-\\u202E\\uFEFF';
const LOCAL = `[\\p{L}\\p{N}._%+\\-${INVISIBLE}]`;
const LABEL = `[\\p{L}\\p{N}\\-${INVISIBLE}]{1,63}`;
const EMAIL = new RegExp(
  `(?:${LOCAL}{1,64}|"[^"\\r\\n@]{1,64}")(?:[@\\uFF20\\uFE6B]|%40)${LABEL}(?:[.\\u3002\\uFF0E]${LABEL}){1,8}`,
  'giu',
);
const URL_USERINFO = /([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/@]{1,256}@/gi;
const BEARER_BASIC = /\b(?:[Bb]earer|BEARER|Basic|BASIC)[ \t]{1,4}[A-Za-z0-9._~+/=-]{4,2048}/g;
const DIGEST = /\b(?:Digest|DIGEST)[ \t]{1,4}[^\r\n]{1,1024}/g;
const TOKEN_SCHEME = /\b(?:Token|ApiKey|Api-Key)[ \t]{1,4}[A-Za-z0-9._~+/=-]{16,2048}/g;
const HEADER_LINE =
  /(\b(?:proxy[-_ ]?authorization|authorization|set[-_ ]?cookie|cookie))(["']?[ \t]{0,3}[:=][ \t]{0,3})[^\r\n]{1,8704}/gi;
const VENDOR =
  /\b(?:sk_(?:live|test)_|rk_live_|pk_live_|sk-ant-|gh[opsur]_|github_pat_|glpat-|xox[abprs]-|AIza|A[KS]IA)[A-Za-z0-9_-]{8,256}/g;
const PEM =
  /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]{0,8192}?(?:-----END [A-Z ]{0,30}PRIVATE KEY-----|$)/g;
const PLAY_TOKEN_PATH = /(\/tokens\/)[A-Za-z0-9._~-]{8,512}/g;
const QUERY_PARAM =
  /([?&;](?:key|code|sig|session|sid|pwd|pw|pin|otp|mfa|\w{0,20}code)=)[^&\s#"']{1,512}/gi;
// Each alternative masks to the end of the token or line (no length gap that would leak a long value's tail).
const QUOTED_OR_BARE = `"[^"\\r\\n]{0,512}(?:"|[^"\\r\\n]*)|'[^'\\r\\n]{0,512}(?:'|[^'\\r\\n]*)|[^\\s"',;]{1,512}[^\\s"',;]*`;

/** Cheap pre-check: strings without any of these cannot match a built-in value pattern. */
const NEEDS_SCAN =
  /[@%=:/＠﹫]|[Bb]earer|BEARER|Basic|BASIC|Digest|DIGEST|Token |ApiKey|Api-Key|eyJ|-----BEGIN|sk_|rk_|pk_|sk-ant|gh[opsur]_|github_pat_|glpat-|xox[abprs]-|AIza|AKIA|ASIA/;

function keyValueRegex(): RegExp {
  const alts = SENSITIVE_KEY_FRAGMENTS.filter((f) => f.length >= 4).map((f) =>
    f.split('').join('[_. -]?'),
  );
  return new RegExp(
    `((?:${alts.join('|')})[\\w.-]{0,40}["']?[ \\t]{0,3}[=:][ \\t]{0,3})(?:${QUOTED_OR_BARE})`,
    'gi',
  );
}
const KEY_VALUE = keyValueRegex();

/** Replace JWTs without regex backtracking: linear, each run of base64url characters is scanned once. */
function scrubJwt(s: string): string {
  let idx = s.indexOf('eyJ');
  if (idx < 0) return s;
  let out = '';
  let last = 0;
  const isB64 = (c: number): boolean =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
  const run = (from: number): number => {
    let p = from;
    while (p < s.length && p - from < 4096 && isB64(s.charCodeAt(p))) p += 1;
    return p;
  };
  while (idx >= 0) {
    const start = idx;
    const seg1 = run(start + 3);
    let end = seg1;
    let matched = false;
    if (seg1 - (start + 3) >= 5 && s.charCodeAt(seg1) === 46) {
      const seg2 = run(seg1 + 1);
      if (seg2 - (seg1 + 1) >= 5) {
        matched = true;
        end = seg2;
        if (s.charCodeAt(seg2) === 46) end = run(seg2 + 1);
      }
    }
    if (matched && (start === 0 || !isWordChar(s.charCodeAt(start - 1)))) {
      out += s.slice(last, start) + REDACTED;
      last = end;
    }
    // On failure no later start inside this run can succeed, so skip the whole run: linear time.
    idx = s.indexOf('eyJ', Math.max(end, start + 3));
  }
  return out + s.slice(last);
}

function isWordChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function globalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function validateConfig(config: RedactionConfig): { keys: string[]; patterns: RegExp[] } {
  const keys: string[] = [];
  for (const raw of config.extraKeys ?? []) {
    const n = typeof raw === 'string' ? normalizeKey(raw) : '';
    if (n.length === 0) {
      throw new TypeError('redact.extraKeys entries must be strings containing a letter or digit');
    }
    keys.push(n);
  }
  const patterns: RegExp[] = [];
  for (const raw of config.extraPatterns ?? []) {
    if (!(raw instanceof RegExp))
      throw new TypeError('redact.extraPatterns entries must be RegExp');
    const g = globalPattern(raw);
    if ('x'.replace(g, '') !== 'x' || ''.replace(g, 'x') !== '') {
      throw new TypeError('redact.extraPatterns must not match the empty string');
    }
    patterns.push(g);
  }
  return { keys, patterns };
}

const KEY_CACHE_LIMIT = 2048;

export function createRedactor(config: RedactionConfig = {}): Redactor {
  const { keys: extraKeys, patterns: extra } = validateConfig(config);
  const fragments = [...SENSITIVE_KEY_FRAGMENTS, ...extraKeys];
  const exact = new Set(SENSITIVE_EXACT_KEYS);
  const cache = new Map<string, boolean>();

  const classify = (key: string): boolean => {
    if (key.length > 1024) return true; // pathological key: treat as sensitive
    const n = normalizeKey(key);
    if (exact.has(n) || fragments.some((f) => n.includes(f))) return true;
    return (n.endsWith('key') || n.endsWith('code')) && !NON_SENSITIVE_SUFFIX_KEYS.includes(n);
  };
  const isSensitiveKey = (key: string): boolean => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const result = classify(key);
    if (cache.size >= KEY_CACHE_LIMIT) cache.clear();
    cache.set(key, result);
    return result;
  };

  const scrubWindow = (value: string): string => {
    let out = value;
    if (NEEDS_SCAN.test(out)) {
      out = out
        .replace(PEM, REDACTED)
        .replace(URL_USERINFO, `$1${REDACTED}@`)
        .replace(HEADER_LINE, `$1$2${REDACTED}`)
        .replace(DIGEST, REDACTED)
        .replace(BEARER_BASIC, REDACTED)
        .replace(TOKEN_SCHEME, REDACTED)
        .replace(VENDOR, REDACTED)
        .replace(PLAY_TOKEN_PATH, `$1${REDACTED}`)
        .replace(QUERY_PARAM, `$1${REDACTED}`)
        .replace(KEY_VALUE, `$1${REDACTED}`);
      out = scrubJwt(out).replace(EMAIL, REDACTED);
    }
    for (const pattern of extra) out = out.replace(pattern, REDACTED);
    return out;
  };

  const scrubString = (value: string): string => {
    if (value.length <= MAX_STRING_LENGTH) return scrubWindow(value);
    // Scan a little past the cut so a secret straddling the boundary is removed whole, then cut.
    const scanned = scrubWindow(value.slice(0, MAX_STRING_LENGTH + SCAN_OVERLAP)).slice(
      0,
      MAX_STRING_LENGTH,
    );
    return `${scanned}...[truncated ${String(value.length - MAX_STRING_LENGTH)} chars]`;
  };

  const safeKey = (key: string): string => {
    const cut = key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}...` : key;
    const scrubbed = scrubString(cut);
    return RESERVED_KEYS.includes(scrubbed) ? `_${scrubbed}` : scrubbed;
  };

  const newObject = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;

  interface Ctx {
    nodes: number;
  }

  const readProp = (source: object, key: string): unknown => {
    try {
      return (source as Record<string, unknown>)[key];
    } catch {
      return '[Unreadable]';
    }
  };

  const tag = (value: object): string => Object.prototype.toString.call(value);

  const text = (value: unknown, depth: number, ctx: Ctx, anc: WeakSet<object>): string => {
    if (typeof value === 'string') return scrubString(value);
    const w = walk(value, depth, ctx, anc);
    if (typeof w === 'string') return w;
    const json = JSON.stringify(w) as string | undefined;
    return json ?? String(w);
  };

  function setEntry(
    out: Record<string, unknown>,
    key: string,
    read: () => unknown,
    depth: number,
    ctx: Ctx,
    anc: WeakSet<object>,
  ): void {
    out[safeKey(key)] = isSensitiveKey(key) ? REDACTED : walk(read(), depth + 1, ctx, anc);
  }

  function serializeError(err: object, depth: number, ctx: Ctx, anc: WeakSet<object>): unknown {
    const out = newObject();
    out['type'] = text(readProp(err, 'name'), depth + 1, ctx, anc);
    out['message'] = text(readProp(err, 'message'), depth + 1, ctx, anc);
    const stack = readProp(err, 'stack');
    if (typeof stack === 'string') out['stack'] = scrubString(stack);
    let count = 0;
    for (const key of Object.keys(err)) {
      if (['name', 'message', 'stack', 'cause', 'errors'].includes(key)) continue;
      if (count >= MAX_ENTRIES) break;
      count += 1;
      const target = key === 'type' ? '_type' : key;
      if (key === 'code') {
        const code = readProp(err, key);
        // Error codes (ENOENT, ECONNRESET) are diagnostics, not OAuth codes.
        out[target] =
          typeof code === 'number' || (typeof code === 'string' && SAFE_ERROR_CODE.test(code))
            ? text(code, depth + 1, ctx, anc)
            : REDACTED;
        continue;
      }
      setEntry(out, target, () => readProp(err, key), depth, ctx, anc);
    }
    if ('cause' in err) out['cause'] = walk(readProp(err, 'cause'), depth + 1, ctx, anc);
    const errors = readProp(err, 'errors');
    if (Array.isArray(errors)) out['errors'] = walk(errors, depth + 1, ctx, anc);
    return out;
  }

  const isSensitiveName = (item: unknown): boolean =>
    typeof item === 'string' && item.length <= 64 && isSensitiveKey(item);

  function walkArray(
    items: readonly unknown[],
    depth: number,
    ctx: Ctx,
    anc: WeakSet<object>,
  ): unknown {
    const out: unknown[] = [];
    const limit = Math.min(items.length, MAX_ENTRIES);
    for (let i = 0; i < limit; i += 1) {
      const item = items[i];
      out.push(walk(item, depth + 1, ctx, anc));
      // rawHeaders-style [name, value, name, value]: the value after a sensitive name is redacted. A masked
      // value that is itself a sensitive name (misaligned pairs) also masks the element after it.
      let name: unknown = item;
      while (isSensitiveName(name) && i + 1 < limit) {
        out.push(REDACTED);
        i += 1;
        name = items[i];
      }
    }
    if (items.length > limit) out.push(`[+${String(items.length - limit)} more]`);
    return out;
  }

  function walkObject(value: object, depth: number, ctx: Ctx, anc: WeakSet<object>): unknown {
    const kind = tag(value);
    if (value instanceof Error || kind === '[object Error]')
      return serializeError(value, depth, ctx, anc);
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    }
    if (kind === '[object String]' || kind === '[object Number]' || kind === '[object Boolean]') {
      return walk((value as { valueOf: () => unknown }).valueOf(), depth, ctx, anc);
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return `[Binary ${String(value.byteLength)} bytes]`;
    }
    if (value instanceof Map) {
      const out = newObject();
      let count = 0;
      for (const [k, v] of value) {
        if (count >= MAX_ENTRIES) {
          out['_truncatedKeys'] = value.size - count;
          break;
        }
        count += 1;
        const key = typeof k === 'string' ? k : text(k, depth + 1, ctx, anc);
        setEntry(out, key, () => v, depth, ctx, anc);
      }
      return out;
    }
    if (value instanceof Set) {
      const items: unknown[] = [];
      for (const item of value) {
        if (items.length > MAX_ENTRIES) break;
        items.push(item);
      }
      return walkArray(items, depth, ctx, anc);
    }
    if (Array.isArray(value)) return walkArray(value as unknown[], depth, ctx, anc);

    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Class instances: JSON.stringify would call toJSON, so sanitise what it returns.
      const toJSON = readProp(value, 'toJSON');
      if (typeof toJSON === 'function') {
        try {
          return walk((toJSON as () => unknown).call(value), depth + 1, ctx, anc);
        } catch {
          return '[Unserializable]';
        }
      }
    }
    const out = newObject();
    const keys = Object.keys(value);
    const limit = Math.min(keys.length, MAX_ENTRIES);
    for (let i = 0; i < limit; i += 1) {
      const key = keys[i] ?? '';
      setEntry(out, key, () => readProp(value, key), depth, ctx, anc);
    }
    if (keys.length > limit) out['_truncatedKeys'] = keys.length - limit;
    return out;
  }

  function walk(value: unknown, depth: number, ctx: Ctx, anc: WeakSet<object>): unknown {
    switch (typeof value) {
      case 'string':
        return scrubString(value);
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
        if (anc.has(value)) return CIRCULAR;
        ctx.nodes += 1;
        if (depth >= MAX_DEPTH || ctx.nodes > MAX_NODES) return TRUNCATED;
        anc.add(value);
        try {
          return walkObject(value, depth, ctx, anc);
        } catch {
          return '[Unserializable]';
        } finally {
          anc.delete(value);
        }
      }
    }
  }

  return {
    sanitize: (value) => {
      try {
        return walk(value, 0, { nodes: 0 }, new WeakSet<object>());
      } catch {
        return '[Unserializable]';
      }
    },
    scrubString,
    isSensitiveKey,
  };
}
