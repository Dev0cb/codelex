# @codelex/observability

Structured JSON logger for every CODELEX service (ENGINEERING §7) with mandatory redaction of secrets and PII
(CLAUDE.md principle 7 and §5: never log PII, tokens, receipts, raw chat).

- Owner: `devops-sre`
- Status: minimal (sprint S3). Logger and redaction only. There is **no OpenTelemetry exporter, tracer or metrics
  helper yet**: they are deferred to Phase 2 (E-2.9). `traceId` / `spanId` are plain accepted fields so log lines can
  be correlated once tracing exists.
- Runtime dependency: `pino` 10.3.1 (MIT, on the ENGINEERING §6 allowlist). pino is not re-exported; callers see
  only the `Logger` interface below, so there is no way to reach pino without the redactor.

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
reqLog.warn({ body: summarizeBody(req.body) }, 'rejected'); // shape only, never content
```

| Export                                                        | Purpose                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createLogger(options)`                                       | Returns `Logger` (`error`, `warn`, `info`, `debug`, `child`, `level`, `isLevelEnabled`). Throws `TypeError` on an invalid `service`, `component` or `level`. |
| `parseLevel(value)`                                           | Narrow an untrusted string to a level or throw. No `any`, no casts at call sites.                                                                            |
| `summarizeBody(body)`                                         | `{ kind, size }` of a request/response body. The only sanctioned way to mention a body.                                                                      |
| `createRedactor(config)`                                      | The redaction engine, for non-logger uses (error reporters, analytics sinks). `sanitize`, `scrubString`, `scrubLine`, `isSensitiveKey`.                      |
| `REDACTED`, `SENSITIVE_KEY_FRAGMENTS`, `SENSITIVE_EXACT_KEYS` | Constants.                                                                                                                                                   |
| types `Logger`, `LoggerOptions`, `LogFields`, `LogLevel`, ... |                                                                                                                                                              |

Output is one JSON object per line: `level` (label), `time` (ISO 8601), `service`, optional `component`, `msg`,
then the sanitised fields. The default destination is `process.stdout`; tests pass `destination: { write }`.
User fields named `level`, `time`, `msg`, `service`, `component` are renamed with a leading `_` so they cannot
spoof the envelope.

Levels: `error` actionable, `warn`, `info` business events and sparse, `debug` off in production.

## Redaction guarantees

Every call (`log.*`, `child` bindings, errors) is deep-copied through the redactor before pino sees it; the
serialised line is scrubbed once more before it reaches the destination.

| Class                 | Rule                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tokens and secrets    | Key whose normalised form (NFKC, lower-case, only `a-z0-9`) contains `token`, `bearer`, `authorization`, `apikey`, `accesskey`, `password`, `passwd`, `passphrase`, `secret`, `credential`, `privatekey`, `cookie`, `jwt`, `sessionid`, `csrf`, `xsrf`, `signature`. Value replaced by `[REDACTED]`, whatever its shape. |
| Emails                | Key containing `email` (any casing, `E-Mail`, `user_email`), and any email address (also `%40` form, Unicode letters) inside any string value, message or object key.                                                                                                                                                    |
| Payment receipts      | Keys containing `receipt`, `signedtransaction`, `signedrenewal`, `jws`, `purchasedata`, `originaljson` (App Store receipt-data / signed transaction info, Play purchase data and signature) and `purchaseToken` (via `token`).                                                                                           |
| Raw payloads and chat | Keys `body`, `chat` (exact) and containing `rawbody`, `requestbody`, `responsebody`, `rawchat`, `chatmessage`.                                                                                                                                                                                                           |
| Secrets inside text   | `Bearer <token>`, JWTs (`eyJ...`), and `token=...` / `password: ...` / `api_key=...` pairs inside strings (including error messages and stacks).                                                                                                                                                                         |
| Errors                | `Error` instances (anywhere, also `cause`, `AggregateError.errors`, own properties such as an HTTP client `config.headers`) become `{ type, message, stack, ... }` with message and stack scrubbed.                                                                                                                      |
| Shapes                | Nesting depth (objects, arrays, `Map`, `Set`, class instances, `toJSON`), casing and separators, full-width characters, cycles (`[Circular]`), depth over 10 (`[Truncated]`), throwing getters/proxies (`[Unserializable]`), binary (`[Binary n bytes]`), strings over 8192 chars are cut.                               |

Redaction by key is a contains-match on purpose: over-redaction (`tokenCount`) is accepted, leaks are not.

### Adding keys and patterns

```ts
createLogger({
  service: 'social',
  redact: { extraKeys: ['friendCode', 'phone'], extraPatterns: [/CDX-\d{6}/] },
});
```

`extraKeys` are normalised and contains-matched; `extraPatterns` are applied to string values. They add to the
built-in rules and can never switch one off. A new always-on rule belongs in `src/redact.ts` with a test.

### Known limits

- Redaction is heuristic. A secret under an innocuous key and in free text without a recognisable shape (for
  example `{ note: 'my code is 482913' }`, an opaque session value) is **not** detected. Do not log such values;
  use ids.
- Emails with a local part over 64 characters keep their first characters; obfuscated forms (`bob at example dot
com`) are not detected.
- Non-email PII (names, phone numbers, IP addresses, free-text chat) is not pattern-matched. Keys `body` and
  `chat` are covered, a chat message under another key is not.
- Only the logger's own output is protected. `console.log` and other libraries writing to stdout bypass it: lint
  forbids neither yet, services must not use `console`.
- Properties of class instances that live on the prototype (getters) are not enumerated, so are not logged.

## Using from a service

1. `package.json`: `"@codelex/observability": "workspace:*"` in `dependencies`.
2. Create one root logger at start-up in the composition root, read `LOG_LEVEL` through `parseLevel`, inject it
   (or children of it) into use-cases. Do not create loggers at import time in libraries.
3. Per request / match / job: `log.child({ requestId, matchId, traceId, spanId })`.
4. Never log request bodies, headers wholesale, receipts or LLM prompts; log ids, counts and `summarizeBody`.

## Tests and commands

`src/*.test.ts` hold unit tests and fast-check properties (secret keys at any depth and casing, email-like
strings in values / keys / messages / errors, arbitrary JSON never leaks injected secrets and always yields valid
JSON). Strict coverage preset: 90 % on lines, statements, functions and branches.

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/observability
```
