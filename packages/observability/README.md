# @codelex/observability

Structured JSON logger for every CODELEX service (ENGINEERING §7) with mandatory redaction of secrets and PII
(CLAUDE.md principle 7 and §5: never log PII, tokens, receipts, raw chat).

- Owner: `devops-sre`
- Status: minimal (sprint S3). Logger and redaction only. There is **no OpenTelemetry exporter, tracer or metrics
  helper yet**: they are deferred to Phase 2 (E-2.9). `traceId` / `spanId` are plain accepted fields so log lines
  can be correlated once tracing exists.
- Zero runtime dependencies. The record is built here and serialised with `JSON.stringify`; no third-party
  serializer, child-logger or request/response mapper ever sees caller data (an earlier pino-based version let
  object-prototype keys and forged keys corrupt lines). The output shape is pino-compatible (`level` is a label,
  `time` ISO, `msg`), so pino tooling such as `pino-pretty` can read it.

## API (single entry point, ESM)

```ts
import { createLogger, summarizeBody, parseLevel } from '@codelex/observability';

const log = createLogger({
  service: 'gateway', // required, [a-z0-9._-], becomes the `service` field
  component: 'http', // optional, becomes `component`
  level: parseLevel(process.env['LOG_LEVEL'] ?? 'info'), // error | warn | info | debug | silent
});

log.info({ matchId, userId }, 'match started'); // fields first, message second
log.error(err); // an Error is serialised under `err`
const reqLog = log.child({ traceId, spanId, requestId });
reqLog.warn({ bodyShape: summarizeBody(req.body) }, 'rejected'); // shape only; a key named `body` is redacted
```

| Export                                                        | Purpose                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLogger(options)`                                       | Returns `Logger` (`error`, `warn`, `info`, `debug`, `child`, `level`, `isLevelEnabled`, `flush`). Throws `TypeError` on invalid `service`, `component`, `level`, `destination` or `redact`. |
| `parseLevel(value)`                                           | Narrow an untrusted string to a level or throw.                                                                                                                                             |
| `summarizeBody(body)`                                         | `{ kind, size }` of a body. The only sanctioned way to mention a body.                                                                                                                      |
| `createRedactor(config)`                                      | The redaction engine, for non-logger uses. `sanitize`, `scrubString`, `isSensitiveKey`.                                                                                                     |
| `REDACTED`, `SENSITIVE_KEY_FRAGMENTS`, `SENSITIVE_EXACT_KEYS` | Constants. The other limits in `redact.ts` (`MAX_DEPTH`, `MAX_STRING_LENGTH`, `MAX_ENTRIES`, `MAX_NODES`) are internal tuning knobs, not API.                                               |

Output is one JSON object per line, in this order: `level` (label), `time` (ISO 8601), `service`, optional
`component`, child bindings, call fields, `msg`. User fields named `level`, `time`, `msg`, `service`, `component`
are renamed with a leading `_` so they cannot spoof the envelope. U+2028/U+2029 are escaped.

Semantics:

- Writes are **synchronous**: one `destination.write(line)` per call (default `process.stdout`). `flush()` is a
  no-op today; call it before exit so a buffered destination can be swapped in without touching callers.
- **Logging never throws.** A throwing getter, Proxy, non-string message, or a destination whose `write` throws
  (EPIPE) is contained; if the record itself cannot be built, a minimal `{"msg":"log_failed"}` line is written.
- A disabled level returns before the fields are read (no getter runs, no cost beyond the level check).
- Lines longer than 32 KB are replaced by the envelope plus `"truncated":true` and the message.
- `level`: `error` actionable, `warn`, `info` business events and sparse, `debug` off in production.

## Redaction guarantees

Every call (fields, bindings, messages, errors) is deep-copied through the redactor before the record is built;
the record is plain `JSON.stringify` output of that copy, so every key and value is escaped by construction and
a call always produces exactly one valid JSON line.

| Class                  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens and secrets     | Key whose normalised form contains `token`, `bearer`, `authorization`, `auth`, `apikey`, `accesskey`, `pass` (password, passwd, passphrase), `pwd`, `secret`, `credential`, `privatekey`, `privkey`, `cookie`, `jwt`, `session`, `csrf`, `xsrf`, `signature`, `connectionstring`, `databaseurl`, French `motdepasse`, `mdp`, `jeton`; or equals `key`, `code`, `sid`, `pw`, `pin`, `otp`, `mfa`, `dsn`. Value replaced whatever its shape.                                                                                                                                                        |
| Emails and identifiers | Keys containing `email`, `courriel`, `phone`, `deviceid`, `idfa`, `gaid`, `adid`, `forwardedfor`, `ipaddress`, `clientip`, `remoteaddress`, or equal to `ip`. Any email address inside any string, key or message (also `%40`, full-width `＠`, zero-width / bidi characters, quoted local parts).                                                                                                                                                                                                                                                                                                |
| Payment receipts       | Keys containing `receipt`, `signedtransaction`, `signedrenewal`, `jws`, `purchasedata`, `originaljson`; `purchaseToken` via `token`; Google Play `/tokens/<purchaseToken>` URL paths.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Raw payloads and chat  | Keys containing `payload`, `rawbody`, `requestbody`, `responsebody`, `reqbody`, `resbody`, `rawchat`, `chatmessage`, or equal to `body`, `chat`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Secrets inside text    | `Authorization` / `Proxy-Authorization` / `Cookie` / `Set-Cookie` header values to end of line (so `_header` strings are covered; `rawHeaders`-style arrays redact the item after a sensitive name), `Bearer` / `Basic` / `Digest` / `Token` / `ApiKey` credentials, JWTs, `keyword=value` and `keyword: "quoted value"` pairs for the key list above, `?key=` `?code=` `?sig=` `?session=` `?sid=` query values, URL userinfo (`scheme://user:pw@host`, `redis://:pw@host`), vendor prefixes (`sk_live_`, `sk-ant-`, `ghp_`, `github_pat_`, `AKIA...`, `xox*-`, `AIza`), PEM private key blocks. |
| Errors                 | `Error` instances (also cross-realm, `cause`, `AggregateError.errors`, own properties such as an HTTP client's `config.headers`) become `{ type, message, stack, ... }` with message and stack scrubbed. Own `type` is kept as `_type`. `Error.code` (`ENOENT`) is kept: on errors it is a diagnostic, not an OAuth code.                                                                                                                                                                                                                                                                         |
| Evasions               | Key casing, separators, accents, full-width characters and common Cyrillic/Greek/Turkish homoglyphs (`еmail`, `pаssword`, `apıKey`) are normalised before matching. Boxed `String`/`Number`/`Boolean` are unwrapped.                                                                                                                                                                                                                                                                                                                                                                              |
| Shapes and limits      | Objects, arrays, `Map`, `Set`, class instances (a `toJSON` method is called, its result sanitised), cycles (`[Circular]`), depth over 10 (`[Truncated]`), a throwing getter (`[Unreadable]`) or proxy / `toJSON` (`[Unserializable]`), binary (`[Binary n bytes]`). Every string is cut at 8192 characters (`...[truncated n chars]`) after scanning 320 characters past the cut; keys at 256; 200 entries per object or array; 5000 nodes per call.                                                                                                                                              |

Key matching is a contains-match on purpose: over-redaction (`tokenCount`, `author`, `passed`, `bypass`) is
accepted, leaks are not. Key classification is cached (bounded) and strings without any secret-shaped character
skip the regexes, so a typical 10-field call costs about 5 µs (Node 22, `node` micro-benchmark on the CI-class
dev container, destination a no-op; raw pino measured about 1.75 µs for the same fields, the review baseline
before this design was 25.6 µs).

### Adding keys and patterns

```ts
createLogger({
  service: 'social',
  redact: { extraKeys: ['friendCode', 'nickname'], extraPatterns: [/CDX-\d{6}/] },
});
```

`extraKeys` are normalised and contains-matched; `extraPatterns` are applied to string values and must not match
the empty string (a `TypeError` is thrown at creation otherwise). They add to the built-in rules and can never
switch one off. A new always-on rule belongs in `src/redact.ts` with a test.

### Known limits

- Redaction is heuristic. A secret under an innocuous key and in free text without a recognisable shape (for
  example `{ note: 'my code is 482913' }`, an opaque session value) is **not** detected. Do not log such values;
  use ids.
- Emails with a local part over 64 characters keep their first characters; obfuscated forms (`bob at example dot
com`) are not detected.
- Non-email PII (names, addresses, IPs inside free text, chat text under another key) is not pattern-matched.
- Contents past the 8192-character cut are dropped, not scanned; the 320-character overlap protects a secret
  straddling the cut only up to that length.
- `Basic <word>` in prose is redacted (over-redaction); `Token` / `ApiKey` schemes need 16+ credential characters.
- Only the logger's output is protected. `console.log` and other libraries writing to stdout bypass it:
  services must not use `console`.
- Properties on a class prototype (getters) are not enumerated, so are not logged.
- Arrays redact the element after a sensitive-looking string (`['Authorization', value]`), which can hide an
  innocent neighbour in word lists.

## Using from a service

1. `package.json`: `"@codelex/observability": "workspace:*"` in `dependencies`.
2. Create one root logger at start-up in the composition root, read `LOG_LEVEL` through `parseLevel`, inject it
   (or children of it) into use-cases. Do not create loggers at import time in libraries.
3. Per request / match / job: `log.child({ requestId, matchId, traceId, spanId })`.
4. Never log request bodies, headers wholesale, receipts or LLM prompts; log ids, counts and `summarizeBody`.

## Tests and commands

`src/*.test.ts` hold unit tests, the review regression suite (`review.test.ts`) and fast-check properties
(secret keys at any depth and casing, email-like strings in values / keys / messages / errors, arbitrary strings
always give one parseable record). Timing tests assert linearity (4x input is far below 16x time), never a
wall-clock budget on hostile input except a generous 50 ms ceiling after truncation. Strict coverage preset: 90 %
on lines, statements, functions and branches.

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/observability
```
