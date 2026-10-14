/**
 * CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320), the per-record checksum of the on-device match log (threat
 * model TM-01). Error detection only, never authentication: the log is the player's own casual match (§1.1).
 */
const TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  // Indexed loop: the iterator protocol costs several times more per byte on Hermes and under Jest.
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
