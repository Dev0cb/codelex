import { at } from './format.js';

/** CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320): corruption check of `.clxi` artefacts. Pure JS. */
const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Continues a CRC over `bytes[from, to)`; start with `crc = 0`. */
export function crc32(bytes: Uint8Array, from = 0, to = bytes.length, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = from; i < to; i += 1) {
    c = at(TABLE, (c ^ at(bytes, i)) & 0xff) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
