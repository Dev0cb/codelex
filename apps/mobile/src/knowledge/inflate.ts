/**
 * Raw DEFLATE decoder (RFC 1951) and base64 decoder for the bundled Knowledge Card text (E-1.5 slice S5,
 * `scripts/cards-asset.mjs`). Hermes has no `DecompressionStream`, and the text costs about 3x more bundle bytes
 * uncompressed (mobile-app-foundation note §3.3), so the app carries this small decoder instead of a dependency.
 *
 * Table-driven: each Huffman code gets a single-level lookup table indexed by the next `maxBits` input bits (LSB
 * first, as DEFLATE packs them), so a symbol costs one table read. Every malformed input throws `InflateError` (no
 * partial output is ever returned); the output never exceeds `maxLength`, so hostile input cannot grow memory.
 */

export class InflateError extends Error {
  readonly code = 'CARDS_DECODE';
  constructor(message: string) {
    super(message);
    this.name = 'InflateError';
  }
}

const fail = (message: string): never => {
  throw new InflateError(message);
};

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** Order of the code-length code lengths in a dynamic block header. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const MAX_BITS = 15;
const END_OF_BLOCK = 256;

/** Lookup table: entry = symbol << 4 | code length; 0 = no code has these bits. */
interface Table {
  readonly entries: Uint32Array;
  readonly bits: number;
}

/** Canonical Huffman table from code lengths (RFC 1951 §3.2.2); rejects over-subscribed codes. */
function buildTable(lengths: ArrayLike<number>): Table {
  const counts = new Uint16Array(MAX_BITS + 1);
  let maxBits = 0;
  for (let s = 0; s < lengths.length; s += 1) {
    const len = lengths[s] ?? 0;
    counts[len] = (counts[len] ?? 0) + 1;
    if (len > maxBits) maxBits = len;
  }
  counts[0] = 0;
  let left = 1;
  const next = new Uint16Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len += 1) {
    left = (left << 1) - (counts[len] ?? 0);
    if (left < 0) fail('over-subscribed Huffman code');
    next[len + 1] = ((next[len] ?? 0) + (counts[len] ?? 0)) << 1;
  }
  const bits = Math.max(maxBits, 1);
  const entries = new Uint32Array(1 << bits);
  for (let s = 0; s < lengths.length; s += 1) {
    const len = lengths[s] ?? 0;
    if (len === 0) continue;
    const code = next[len] ?? 0;
    next[len] = code + 1;
    // Huffman codes are sent MSB first inside an LSB-first bit stream: index by the reversed code.
    let reversed = 0;
    for (let i = 0; i < len; i += 1) reversed |= ((code >> i) & 1) << (len - 1 - i);
    const entry = (s << 4) | len;
    for (let i = reversed; i < entries.length; i += 1 << len) entries[i] = entry;
  }
  return { entries, bits };
}

const FIXED_LITERALS = buildTable(
  Array.from({ length: 288 }, (_, s) => (s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8)),
);
const FIXED_DISTANCES = buildTable(Array.from({ length: 30 }, () => 5));

/**
 * Inflates a raw DEFLATE stream (no zlib or gzip header). Throws {@link InflateError} on any malformed input or when
 * the output would exceed `maxLength` bytes.
 */
export function inflateRaw(input: Uint8Array, maxLength = Number.POSITIVE_INFINITY): Uint8Array {
  const totalBits = input.length * 8;
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let consumed = 0;

  // Fills at least `n` (≤ 24) bits; past the end it shifts in zeros, which `consume` then refuses to use.
  const fill = (n: number): void => {
    while (bitCnt < n) {
      bitBuf |= (input[pos] ?? 0) << bitCnt;
      pos += 1;
      bitCnt += 8;
    }
  };
  const consume = (n: number): void => {
    bitBuf >>>= n;
    bitCnt -= n;
    consumed += n;
    if (consumed > totalBits) fail('truncated stream');
  };
  const bits = (n: number): number => {
    if (n === 0) return 0;
    fill(n);
    const value = bitBuf & ((1 << n) - 1);
    consume(n);
    return value;
  };
  const symbol = (table: Table): number => {
    fill(table.bits);
    const entry = table.entries[bitBuf & ((1 << table.bits) - 1)] ?? 0;
    const len = entry & 15;
    if (len === 0) fail('invalid Huffman code');
    consume(len);
    return entry >>> 4;
  };

  let out = new Uint8Array(Number.isFinite(maxLength) ? Math.min(maxLength, 1 << 24) : 1 << 16);
  let outLen = 0;
  const ensure = (extra: number): void => {
    const need = outLen + extra;
    if (need > maxLength) fail('output longer than expected');
    if (need <= out.length) return;
    let size = out.length * 2;
    while (size < need) size *= 2;
    const grown = new Uint8Array(Math.min(size, maxLength));
    grown.set(out.subarray(0, outLen));
    out = grown;
  };

  const readDynamicTables = (): [Table, Table] => {
    const hlit = bits(5) + 257;
    const hdist = bits(5) + 1;
    const hclen = bits(4) + 4;
    if (hlit > 286 || hdist > 30) fail('too many length or distance codes');
    const clLengths = new Uint8Array(19);
    for (let i = 0; i < hclen; i += 1) clLengths[CODE_LENGTH_ORDER[i] ?? 0] = bits(3);
    const clTable = buildTable(clLengths);
    const lengths = new Uint8Array(hlit + hdist);
    let i = 0;
    while (i < lengths.length) {
      const sym = symbol(clTable);
      if (sym < 16) {
        lengths[i] = sym;
        i += 1;
        continue;
      }
      let value = 0;
      let repeat: number;
      if (sym === 16) {
        if (i === 0) fail('repeat with no previous length');
        value = lengths[i - 1] ?? 0;
        repeat = 3 + bits(2);
      } else if (sym === 17) {
        repeat = 3 + bits(3);
      } else {
        repeat = 11 + bits(7);
      }
      if (i + repeat > lengths.length) fail('code lengths overflow');
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    if (lengths[END_OF_BLOCK] === 0) fail('no end-of-block code');
    return [buildTable(lengths.subarray(0, hlit)), buildTable(lengths.subarray(hlit))];
  };

  let final = 0;
  do {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      // Stored: skip to the byte boundary (fewer than 8 bits are buffered), then LEN and its complement.
      consume(bitCnt);
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > input.length) fail('truncated stored block');
      const len = (input[pos] ?? 0) | ((input[pos + 1] ?? 0) << 8);
      const nlen = (input[pos + 2] ?? 0) | ((input[pos + 3] ?? 0) << 8);
      if ((len ^ 0xffff) !== nlen) fail('stored block length check failed');
      pos += 4;
      if (pos + len > input.length) fail('truncated stored block');
      ensure(len);
      out.set(input.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
      consumed = pos * 8;
      continue;
    }
    if (type === 3) fail('invalid block type');
    const [literals, distances] =
      type === 1 ? [FIXED_LITERALS, FIXED_DISTANCES] : readDynamicTables();
    for (;;) {
      const sym = symbol(literals);
      if (sym < 256) {
        ensure(1);
        out[outLen] = sym;
        outLen += 1;
        continue;
      }
      if (sym === END_OF_BLOCK) break;
      const li = sym - 257;
      if (li >= 29) fail('invalid length symbol');
      const length = (LENGTH_BASE[li] ?? 0) + bits(LENGTH_EXTRA[li] ?? 0);
      const di = symbol(distances);
      if (di >= 30) fail('invalid distance symbol');
      const distance = (DIST_BASE[di] ?? 0) + bits(DIST_EXTRA[di] ?? 0);
      if (distance > outLen) fail('distance before the start of the output');
      ensure(length);
      // Byte by byte: a match may overlap its own output (distance < length).
      for (let k = 0; k < length; k += 1) {
        out[outLen] = out[outLen - distance] ?? 0;
        outLen += 1;
      }
    }
  } while (final === 0);
  return out.slice(0, outLen);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES: Int16Array = (() => {
  const values = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64.length; i += 1) values[BASE64.charCodeAt(i)] = i;
  return values;
})();

/** Standard base64 (RFC 4648 §4, with padding) to bytes; throws {@link InflateError} on anything else. */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) fail('base64 length is not a multiple of 4');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let quad = 0;
    for (let k = 0; k < 4; k += 1) {
      const code = text.charCodeAt(i + k);
      const isPad = code === 61 && i + k >= text.length - padding;
      const value = isPad ? 0 : (BASE64_VALUES[code] ?? -1);
      if (value < 0) fail('invalid base64 character');
      quad = (quad << 6) | value;
    }
    if (o < out.length) out[o++] = (quad >> 16) & 255;
    if (o < out.length) out[o++] = (quad >> 8) & 255;
    if (o < out.length) out[o++] = quad & 255;
  }
  return out;
}
