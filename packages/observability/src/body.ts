export interface BodySummary {
  readonly kind: 'empty' | 'string' | 'binary' | 'array' | 'object' | 'other';
  /** Size in bytes for strings and binary, item/key count for arrays and objects. */
  readonly size: number;
}

/**
 * The only supported way to mention a request or response body in a log line: its shape, never its content.
 * Logging `req.body` directly is also neutralised (the keys `body`, `rawBody`, `requestBody`, `responseBody`
 * are always redacted) but this helper keeps the useful part (is it empty, how large).
 */
export function summarizeBody(body: unknown): BodySummary {
  if (body === undefined || body === null) return { kind: 'empty', size: 0 };
  if (typeof body === 'string') return { kind: 'string', size: Buffer.byteLength(body, 'utf8') };
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    return { kind: 'binary', size: body.byteLength };
  }
  if (Array.isArray(body)) return { kind: 'array', size: body.length };
  if (typeof body === 'object') return { kind: 'object', size: Object.keys(body).length };
  return { kind: 'other', size: 0 };
}
