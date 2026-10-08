/**
 * Record framing of the on-device match log (threat model TM-01, API note §20 Q7 write path). A file is a sequence of
 * records `[u32 BE payload length][u32 BE CRC-32 of the payload][payload]`; payloads are ASCII JSON (the app escapes
 * anything else, so no text codec is needed on Hermes).
 *
 * Reading follows TM-01: the last record may be torn by a kill or a power loss mid-append (short, or its bytes never
 * reached the disk), so a bad record that reaches the end of the file is dropped: it was never shown as committed,
 * because the UI commits a move only after the append returned. Any bad record before it means the file is corrupt.
 *
 * "Reaches the end of the file" is not enough on its own: a damaged length in the middle of the file can also run
 * past the end. A real torn tail is a record the app wrote, cut short: its length is within the cap and its bytes are
 * printable ASCII (JSON) followed only by zeros (blocks that never reached the disk). A record that would swallow
 * the binary header of a later record fails that test and is corruption, never a silently dropped tail.
 */
import { crc32 } from './crc32';

export const RECORD_HEADER_BYTES = 8;
/**
 * Cap of one record, the snapshot cap of TM-02: the largest record is a snapshot (`serializeState`, ≈ 2 KB); a log
 * header is ≈ 300 B and one action ≈ 200 B.
 */
export const MAX_RECORD_BYTES = 64 * 1024;

const MAX_ASCII = 0x7f;
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;

/** Bytes of a record the app wrote, cut short: printable ASCII, then only zeros. */
function isTornWrite(bytes: Uint8Array): boolean {
  let zeros = false;
  for (const byte of bytes) {
    if (byte === 0) zeros = true;
    else if (zeros || byte < PRINTABLE_MIN || byte > PRINTABLE_MAX) return false;
  }
  return true;
}

export function encodeRecord(payload: string): Uint8Array {
  if (payload.length > MAX_RECORD_BYTES) throw new RangeError('record payload too large');
  const out = new Uint8Array(RECORD_HEADER_BYTES + payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    const code = payload.charCodeAt(i);
    if (code > MAX_ASCII) throw new RangeError('record payload must be ASCII');
    out[RECORD_HEADER_BYTES + i] = code;
  }
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  view.setUint32(4, crc32(out.subarray(RECORD_HEADER_BYTES)));
  return out;
}

export type DecodedRecords =
  | {
      readonly ok: true;
      readonly records: readonly string[];
      /** A torn last record was ignored (TM-01). */
      readonly droppedTail: boolean;
    }
  /**
   * `index` = the first bad record, which is not the last one; `records` = the good records before it (an owner may
   * salvage them, e.g. the analytics queue; the match log never does).
   */
  | { readonly ok: false; readonly index: number; readonly records: readonly string[] };

/** Bytes converted per `String.fromCharCode` call: far below any engine's argument limit. */
const TEXT_CHUNK = 4096;

/**
 * Chunked conversion: one string append per byte made a full analytics queue (≈ 3.7 MB, slice S6a) take seconds to
 * load; chunks keep it linear and fast on Hermes.
 */
function asciiText(bytes: Uint8Array): string | null {
  for (let i = 0; i < bytes.length; i += 1) if ((bytes[i] ?? 0) > MAX_ASCII) return null;
  let text = '';
  for (let at = 0; at < bytes.length; at += TEXT_CHUNK) {
    // `apply` takes the typed array as an array-like (a spread would walk it with the iterator protocol).
    text += String.fromCharCode.apply(
      null,
      bytes.subarray(at, at + TEXT_CHUNK) as unknown as number[],
    );
  }
  return text;
}

export function decodeRecords(bytes: Uint8Array): DecodedRecords {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: string[] = [];
  let at = 0;
  while (at < bytes.length) {
    const index = records.length;
    // A header or payload that runs past the end of the file is the torn tail.
    if (bytes.length - at < RECORD_HEADER_BYTES) return { ok: true, records, droppedTail: true };
    const length = view.getUint32(at);
    if (length > MAX_RECORD_BYTES) return { ok: false, index, records };
    const end = at + RECORD_HEADER_BYTES + length;
    const payload = bytes.subarray(at + RECORD_HEADER_BYTES, Math.min(end, bytes.length));
    const text =
      end <= bytes.length && crc32(payload) === view.getUint32(at + 4) ? asciiText(payload) : null;
    if (text === null) {
      return end >= bytes.length && isTornWrite(payload)
        ? { ok: true, records, droppedTail: true }
        : { ok: false, index, records };
    }
    records.push(text);
    at = end;
  }
  return { ok: true, records, droppedTail: false };
}
