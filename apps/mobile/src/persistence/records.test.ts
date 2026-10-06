/**
 * TM-01 record framing (threat model e-1.5-s1-persistence-match-log §7): every record carries a length prefix and a
 * checksum; on read, a trailing partial record is dropped (it was never shown as committed) and a bad record before
 * the tail means the file is corrupt.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { crc32 } from './crc32';
import { decodeRecords, encodeRecord, RECORD_HEADER_BYTES, MAX_RECORD_BYTES } from './records';

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

describe('crc32', () => {
  it('matches the IEEE 802.3 check value', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('records (TM-01)', () => {
  const payloads = ['{"logVersion":1}', '{"a":1,"h":"x"}', '{"a":2,"h":"\\u00e9"}'];
  const file = concat(...payloads.map(encodeRecord));

  it('round-trips the payloads in order', () => {
    expect(decodeRecords(file)).toEqual({ ok: true, records: payloads, droppedTail: false });
  });

  it('reads an empty file as no records', () => {
    expect(decodeRecords(new Uint8Array(0))).toEqual({ ok: true, records: [], droppedTail: false });
  });

  it('drops a trailing partial record at every byte offset of the last record, never flags corruption', () => {
    const lastStart = file.length - encodeRecord(payloads[2] ?? '').length;
    for (let cut = lastStart + 1; cut < file.length; cut += 1) {
      expect(decodeRecords(file.subarray(0, cut))).toEqual({
        ok: true,
        records: payloads.slice(0, 2),
        droppedTail: true,
      });
    }
  });

  it('drops a last record whose bytes did not reach the disk (zero-filled tail)', () => {
    const torn = file.slice();
    torn.fill(0, file.length - 3);
    expect(decodeRecords(torn)).toEqual({
      ok: true,
      records: payloads.slice(0, 2),
      droppedTail: true,
    });
  });

  it('flags a bad record before the tail as corrupt', () => {
    const bad = file.slice();
    const at = RECORD_HEADER_BYTES + 2; // inside the first payload
    bad[at] = (bad[at] ?? 0) ^ 0xff;
    expect(decodeRecords(bad)).toEqual({ ok: false, index: 0 });
  });

  it('flags an oversized length before the tail as corrupt', () => {
    const oversized = new Uint8Array(RECORD_HEADER_BYTES + MAX_RECORD_BYTES + 1).fill(0x20);
    new DataView(oversized.buffer).setUint32(0, MAX_RECORD_BYTES + 1);
    expect(decodeRecords(concat(oversized, file))).toEqual({ ok: false, index: 0 });
  });

  it('never throws on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        const out = decodeRecords(bytes);
        expect(typeof out.ok).toBe('boolean');
      }),
    );
  });

  it('refuses to encode a payload above the record cap or outside ASCII', () => {
    expect(() => encodeRecord('x'.repeat(MAX_RECORD_BYTES + 1))).toThrow(RangeError);
    expect(() => encodeRecord('\u00e9')).toThrow(RangeError);
  });

  it('flags a non-ASCII payload byte before the tail as corrupt', () => {
    const record = encodeRecord('ab');
    const forged = record.slice();
    forged[RECORD_HEADER_BYTES] = 0xc3;
    new DataView(forged.buffer).setUint32(4, crc32(forged.subarray(RECORD_HEADER_BYTES)));
    expect(decodeRecords(concat(forged, record))).toEqual({ ok: false, index: 0 });
  });
});
