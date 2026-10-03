/**
 * `.clxi` format version 1 (lexicon-index note §3.3; this file is the normative layout). Little-endian; every
 * section starts on an 8-byte boundary; padding is zero; the artefact ends at the first 8-byte boundary after
 * the last section; no timestamps, no paths. All strings are ASCII.
 *
 * Header (56 bytes) then a section table of SECTION_COUNT × (offset u32, length u32), then the sections:
 *
 * | Offset | Field |
 * |---|---|
 * | 0  | magic `CLXI` |
 * | 4  | formatVersion u16 (= 1) |
 * | 6  | flags u16: bit 0 = GADDAG present (FLAG_GADDAG); any other bit set ⇒ UNSUPPORTED_FORMAT |
 * | 8  | lexiconVersion, 16 ASCII hex chars |
 * | 24 | profile definitionHash, 16 ASCII hex chars |
 * | 40 | profile kind u8 (0 global, 1 season, 2 org) · maxFormLength u8 · reserved u16 (0) |
 * | 44 | CRC-32 of every byte of the artefact except these 4 |
 * | 48 | section count u32 (= SECTION_COUNT) · reserved u32 (0) |
 *
 * Sections (u32 = little-endian unsigned 32-bit):
 * - META       u32 × 9: formCount, termCount, categoryCount, profileIdOffset, profileIdLength, nodeCount, edgeCount
 *              (DAWG), gaddagNodeCount, gaddagEdgeCount (both 0 when flags bit 0 is clear)
 * - STRINGS    ASCII pool: profile id, category ids, term ids
 * - CATEGORIES u32 × 2 per category (offset, length in STRINGS), sorted by id (code unit order)
 * - TERMS      u32 × 6 per TermRef: difficulty | primaryCategory << 8, categoryMask, gameValue, knowledgeXp,
 *              idOffset, idLength. TermRefs are ordered by canonical form (code unit order).
 * - TERM_FORM  u32 per TermRef: FormRef of the canonical form
 * - FORM_TERM  u32 per FormRef: TermRef
 * - FORM_KIND  u8 per FormRef: index in FORM_KINDS (0 = canonical)
 * - ADJ_START  u32 × (termCount + 1): CSR row starts
 * - ADJ        u32 per edge: neighbour TermRef, ascending within a row
 * - ADJ_MASK   u8 per edge: RelationMask (undirected, deduplicated, both ends in profile)
 * - LETTERS    u32 × 26: R-BAG-001 letter counts over every playable form
 * - DAWG_NODES u32 × 2 per node: arcMask (bits 0..25) | final << 31, firstEdge
 * - DAWG_EDGES u32 × 2 per edge: target node, rank (forms reachable through earlier arcs and the node's own
 *              final, i.e. the FormRef offset contributed by taking this arc)
 * - GADDAG_NODES u32 × 2 per node: arcMask (bits 0..26, bit 26 = separator ◇) | final << 31, firstEdge
 * - GADDAG_EDGES u32 per edge: target node
 *
 * The section table always has the 15 entries above (fixed order). When flags bit 0 is clear the two GADDAG
 * sections are empty (length 0, offset = the aligned end of DAWG_EDGES); when it is set the GADDAG is required.
 * GADDAG language: rev(w) and rev(w[0..i]) ◇ w[i..n] for every form w of length n and 1 ≤ i ≤ n−1, nothing else
 * (lexicon-index note §2.3). Edges of both automata are laid out node by node: node k's edges start where node
 * k−1's end, so firstEdge is redundant but checked.
 *
 * Both automata are minimal and their nodes are numbered in a fixed order (root 0, then breadth-first with arcs
 * ascending), so the same forms always give the same bytes. FormRef = rank of the form in code unit order.
 */
export const FORMAT_VERSION = 1;
export const HEADER_LENGTH = 56;
export const CRC_OFFSET = 44;

export const SECTIONS = [
  'META',
  'STRINGS',
  'CATEGORIES',
  'TERMS',
  'TERM_FORM',
  'FORM_TERM',
  'FORM_KIND',
  'ADJ_START',
  'ADJ',
  'ADJ_MASK',
  'LETTERS',
  'DAWG_NODES',
  'DAWG_EDGES',
  'GADDAG_NODES',
  'GADDAG_EDGES',
] as const;
export type SectionName = (typeof SECTIONS)[number];
export const SECTION_COUNT = SECTIONS.length;
export const SECTION_TABLE_OFFSET = HEADER_LENGTH;
export const FIRST_SECTION_OFFSET = align8(HEADER_LENGTH + SECTION_COUNT * 8);

export const META_FIELDS = 9;
/** Header flags bit 0: the GADDAG sections are present. Every other bit is reserved (UNSUPPORTED_FORMAT). */
export const FLAG_GADDAG = 1;
export const KNOWN_FLAGS = FLAG_GADDAG;
export const TERM_FIELDS = 6;
export const FINAL_BIT = 0x8000_0000;
export const ARC_MASK = 0x03ff_ffff;
/** GADDAG arc mask: 26 letters plus the separator (bit 26). */
export const GADDAG_ARC_MASK = 0x07ff_ffff;
export const PROFILE_KINDS = ['global', 'season', 'org'] as const;
/** Category bitmask is a u32 (lexicon-index note §3.3: ≤ 32 categories in format 1). */
export const MAX_CATEGORIES = 32;

export function align8(n: number): number {
  return (n + 7) & ~7;
}

/** Number of set bits of a 32-bit integer (constant time). */
export function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/**
 * Typed-array read for indices already proven in range (section lengths are validated first). The `?? 0` is
 * only there for `noUncheckedIndexedAccess`; keeping it in one place keeps the decoder's branches meaningful.
 */
export function at(array: ArrayLike<number>, index: number): number {
  return array[index] ?? 0;
}

/** String-table read for indices already proven in range. */
export function str(array: readonly string[], index: number): string {
  return array[index] ?? '';
}
