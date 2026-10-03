/**
 * `.clxi` format 1 decoder (lexicon-index note §3.5, §7 T-CORRUPT). Validates the whole artefact once (CRC-32,
 * section table, zero padding, every count, reference and DAWG invariant, and the semantic invariants a CRC
 * cannot vouch for) so that a decoded index can never throw or give a wrong answer afterwards; then serves
 * queries from typed-array views over the bytes.
 *
 * Zero-copy: when `input.byteOffset` is a multiple of 8 the views share `input`'s memory; otherwise the decoder
 * makes one real copy (a Node `Buffer#slice` is a view, so it must not be used for that). Ownership: the loader
 * owns the bytes and must keep them immutable for the lifetime of the decoded index — validation is done once,
 * so writing to the buffer afterwards would bypass it (lexicon-index note §2.2, §3.5).
 */
import { err, ok, type Result } from '@codelex/config/result';
import { DIFFICULTIES, FORM_KINDS, LETTER_COUNT, MAX_FORM_LENGTH } from '../constants.js';
import type {
  CategoryId,
  DefinitionHash,
  Difficulty,
  FormMeta,
  FormRef,
  LetterCode,
  LetterCounts,
  LetterMask,
  LexiconIndex,
  LexiconIndexError,
  LexiconIndexErrorCode,
  LexiconIndexExpectation,
  LexiconVersion,
  RelationMask,
  TermMeta,
  TermRef,
} from '../types.js';
import { crc32 } from './crc32.js';
import {
  ARC_MASK,
  CRC_OFFSET,
  FINAL_BIT,
  FIRST_SECTION_OFFSET,
  FORMAT_VERSION,
  MAX_CATEGORIES,
  META_FIELDS,
  PROFILE_KINDS,
  SECTION_COUNT,
  SECTION_TABLE_OFFSET,
  SECTIONS,
  TERM_FIELDS,
  align8,
  at,
  popcount,
  str,
  type SectionName,
} from './format.js';

const HEX16 = /^[0-9a-f]{16}$/;
const RELATION_BITS = 0x7f;
const U16_MAX = 0xffff;
const CODE_A = 65;

function indexError(
  code: LexiconIndexErrorCode,
  message: string,
  details: Readonly<Record<string, string | number>> = {},
): LexiconIndexError {
  return Object.freeze({ code, message, details: Object.freeze({ ...details }) });
}

const corrupt = (what: string): LexiconIndexError =>
  indexError('CORRUPT', `corrupt .clxi artefact: ${what}`, { what });

function ascii(bytes: Uint8Array, from: number, length: number): string | undefined {
  if (from < 0 || length < 0 || from + length > bytes.length) return undefined;
  let s = '';
  for (let i = from; i < from + length; i += 1) {
    const b = at(bytes, i);
    if (b < 0x21 || b > 0x7e) return undefined;
    s += String.fromCharCode(b);
  }
  return s;
}

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

interface Model {
  readonly bytes: Uint8Array;
  readonly version: LexiconVersion;
  readonly definitionHash: DefinitionHash;
  readonly profileKind: (typeof PROFILE_KINDS)[number];
  readonly profileId: string;
  readonly maxFormLength: number;
  readonly formCount: number;
  readonly termCount: number;
  readonly categories: readonly CategoryId[];
  readonly termIds: readonly string[];
  readonly terms: Uint32Array;
  readonly termForm: Uint32Array;
  readonly formTerm: Uint32Array;
  readonly formKind: Uint8Array;
  readonly adjStart: Uint32Array;
  readonly adj: Uint32Array;
  readonly adjMask: Uint8Array;
  readonly letters: Uint32Array;
  readonly nodes: Uint32Array;
  readonly edges: Uint32Array;
  /** Forms by FormRef, recovered while validating the DAWG. */
  readonly forms: readonly string[];
}

/** Validates the artefact and extracts views; any failure is a typed error. */
function readModel(input: Uint8Array): Result<Model, LexiconIndexError> {
  if (input.length < FIRST_SECTION_OFFSET) {
    return err(
      indexError('TRUNCATED', 'artefact is shorter than the .clxi header', {
        length: input.length,
        required: FIRST_SECTION_OFFSET,
      }),
    );
  }
  if (!littleEndian) {
    return err(indexError('UNSUPPORTED_PLATFORM', 'big-endian platforms are not supported'));
  }
  // `new Uint8Array(typedArray)` always copies into a fresh, 0-offset ArrayBuffer (unlike `Buffer#slice`).
  const bytes = input.byteOffset % 8 === 0 ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stored = view.getUint32(CRC_OFFSET, true);
  const crc = crc32(bytes, CRC_OFFSET + 4, bytes.length, crc32(bytes, 0, CRC_OFFSET, 0));
  if (crc !== stored) return err(corrupt('crc32'));

  if (view.getUint16(6, true) !== 0) return err(corrupt('flags'));
  const version = ascii(bytes, 8, 16);
  const definitionHash = ascii(bytes, 24, 16);
  if (version === undefined || !HEX16.test(version)) return err(corrupt('lexiconVersion'));
  if (definitionHash === undefined || !HEX16.test(definitionHash))
    return err(corrupt('definitionHash'));
  const profileKind = PROFILE_KINDS[at(bytes, 40)];
  const maxFormLength = at(bytes, 41);
  if (profileKind === undefined) return err(corrupt('profile kind'));
  if (view.getUint16(42, true) !== 0 || view.getUint32(52, true) !== 0)
    return err(corrupt('reserved'));
  if (view.getUint32(48, true) !== SECTION_COUNT) return err(corrupt('section count'));

  // Section table: aligned, in bounds, in order, non-overlapping.
  const section = {} as Record<SectionName, { offset: number; length: number }>;
  let end = FIRST_SECTION_OFFSET;
  for (let i = 0; i < SECTION_COUNT; i += 1) {
    const offset = view.getUint32(SECTION_TABLE_OFFSET + i * 8, true);
    const length = view.getUint32(SECTION_TABLE_OFFSET + i * 8 + 4, true);
    if (offset % 8 !== 0 || offset < end || offset + length > bytes.length) {
      return err(corrupt(`section ${SECTIONS[i] ?? ''}`));
    }
    section[SECTIONS[i] as SectionName] = { offset, length };
    end = offset + length;
  }
  const u32 = (name: SectionName, count: number): Uint32Array | undefined => {
    const s = section[name];
    if (s.length !== count * 4) return undefined;
    return new Uint32Array(bytes.buffer, bytes.byteOffset + s.offset, count);
  };
  const u8 = (name: SectionName, count: number): Uint8Array | undefined => {
    const s = section[name];
    if (s.length !== count) return undefined;
    return new Uint8Array(bytes.buffer, bytes.byteOffset + s.offset, count);
  };

  const meta = u32('META', META_FIELDS);
  if (meta === undefined) return err(corrupt('META'));
  const [formCount = 0, termCount = 0, categoryCount = 0, profileOffset = 0, profileLength = 0] =
    meta;
  const nodeCount = at(meta, 5);
  const edgeCount = at(meta, 6);
  if (categoryCount > MAX_CATEGORIES || termCount > formCount || formCount === 0) {
    return err(corrupt('counts'));
  }
  const strings = section.STRINGS;
  const pool = new Uint8Array(bytes.buffer, bytes.byteOffset + strings.offset, strings.length);
  const profileId = ascii(pool, profileOffset, profileLength);
  if (profileId === undefined || profileLength === 0) return err(corrupt('profile id'));

  const categoryRefs = u32('CATEGORIES', categoryCount * 2);
  if (categoryRefs === undefined) return err(corrupt('CATEGORIES'));
  const categories: CategoryId[] = [];
  for (let c = 0; c < categoryCount; c += 1) {
    const id = ascii(pool, at(categoryRefs, c * 2), at(categoryRefs, c * 2 + 1));
    const previous = categories[c - 1];
    if (id === undefined || id === '' || (previous !== undefined && !(previous < id))) {
      return err(corrupt('category ids'));
    }
    categories.push(id as CategoryId);
  }

  const terms = u32('TERMS', termCount * TERM_FIELDS);
  const termForm = u32('TERM_FORM', termCount);
  const formTerm = u32('FORM_TERM', formCount);
  const formKind = u8('FORM_KIND', formCount);
  const adjStart = u32('ADJ_START', termCount + 1);
  if (!terms || !termForm || !formTerm || !formKind || !adjStart)
    return err(corrupt('term tables'));
  const edgeTotal = at(adjStart, termCount);
  const adj = u32('ADJ', edgeTotal);
  const adjMask = u8('ADJ_MASK', edgeTotal);
  const letters = u32('LETTERS', LETTER_COUNT);
  const nodes = u32('DAWG_NODES', nodeCount * 2);
  const edges = u32('DAWG_EDGES', edgeCount * 2);
  if (!adj || !adjMask || !letters || !nodes || !edges || nodeCount === 0) {
    return err(corrupt('sections'));
  }
  // Padding before each section is zero ("padding is zero", format.ts), and the artefact ends at the next
  // 8-byte boundary after the last section: one content ⇒ one byte string.
  let gap = FIRST_SECTION_OFFSET;
  for (const name of SECTIONS) {
    if (!zero(bytes, gap, section[name].offset)) return err(corrupt('padding'));
    gap = section[name].offset + section[name].length;
  }
  if (bytes.length !== align8(gap) || !zero(bytes, gap, bytes.length)) {
    return err(corrupt('trailing bytes'));
  }

  const allCategories = categoryCount === 32 ? 0xffffffff : (1 << categoryCount) - 1;
  const termIds: string[] = [];
  const seenIds = new Set<string>();
  let usedCategories = 0;
  for (let t = 0; t < termCount; t += 1) {
    const base = t * TERM_FIELDS;
    const packed = at(terms, base);
    const difficulty = packed & 0xff;
    const primary = packed >>> 8;
    const mask = at(terms, base + 1);
    const id = ascii(pool, at(terms, base + 4), at(terms, base + 5));
    if (
      difficulty >= DIFFICULTIES.length ||
      primary >= categoryCount ||
      (mask & ~allCategories) !== 0 ||
      (mask & (1 << primary)) === 0 ||
      at(terms, base + 2) > U16_MAX ||
      at(terms, base + 3) > U16_MAX ||
      id === undefined ||
      id === ''
    ) {
      return err(corrupt(`term ${String(t)}`));
    }
    if (seenIds.has(id)) return err(corrupt('term ids'));
    seenIds.add(id);
    termIds.push(id);
    usedCategories |= mask;
    const start = at(adjStart, t);
    const stop = at(adjStart, t + 1);
    if (stop < start) return err(corrupt('ADJ_START'));
    for (let e = start; e < stop; e += 1) {
      const target = at(adj, e);
      const relation = at(adjMask, e);
      if (
        target >= termCount ||
        target === t ||
        (e > start && target <= at(adj, e - 1)) ||
        relation === 0 ||
        (relation & ~RELATION_BITS) !== 0
      ) {
        return err(corrupt(`adjacency of ${String(t)}`));
      }
    }
  }
  if (at(adjStart, 0) !== 0) return err(corrupt('ADJ_START'));
  if (usedCategories >>> 0 !== allCategories >>> 0) return err(corrupt('categories'));
  // Exactly one canonical (kind 0) form per term, and it is the one TERM_FORM points to.
  let canonicalForms = 0;
  for (let f = 0; f < formCount; f += 1) {
    const owner = at(formTerm, f);
    const kind = at(formKind, f);
    if (owner >= termCount || kind >= FORM_KINDS.length) {
      return err(corrupt(`form ${String(f)}`));
    }
    if (kind === 0) {
      canonicalForms += 1;
      if (at(termForm, owner) !== f) return err(corrupt('canonical forms'));
    }
  }
  if (canonicalForms !== termCount) return err(corrupt('canonical forms'));

  // DAWG: bounds, then a bounded depth-first enumeration in arc order. It recovers the forms, proves the
  // automaton acyclic within 15 letters, and checks every rank against the enumeration index (FormRef order).
  for (let n = 0; n < nodeCount; n += 1) {
    const word = at(nodes, n * 2);
    const first = at(nodes, n * 2 + 1);
    if ((word & ~(ARC_MASK | FINAL_BIT)) !== 0 || first + popcount(word & ARC_MASK) > edgeCount) {
      return err(corrupt(`node ${String(n)}`));
    }
  }
  for (let e = 0; e < edgeCount; e += 1) {
    if (at(edges, e * 2) >= nodeCount) return err(corrupt(`edge ${String(e)}`));
  }
  const forms: string[] = [];
  const failure = enumerate(nodes, edges, formCount, forms);
  if (failure !== undefined) return err(corrupt(failure));
  if (forms.length !== formCount) return err(corrupt('form count'));
  if (forms.reduce((m, f) => Math.max(m, f.length), 0) !== maxFormLength) {
    return err(corrupt('maxFormLength'));
  }
  // R-BAG-001 letter counts must be those of the enumerated forms.
  const counts = new Uint32Array(LETTER_COUNT);
  for (const form of forms) {
    for (let i = 0; i < form.length; i += 1) {
      const code = form.charCodeAt(i) - CODE_A;
      counts[code] = at(counts, code) + 1;
    }
  }
  for (let code = 0; code < LETTER_COUNT; code += 1) {
    if (at(counts, code) !== at(letters, code)) return err(corrupt('LETTERS'));
  }

  // Terms ↔ forms and relation symmetry.
  for (let t = 0; t < termCount; t += 1) {
    const canonical = at(termForm, t);
    if (canonical >= formCount || formTerm[canonical] !== t || formKind[canonical] !== 0) {
      return err(corrupt(`canonical form of ${String(t)}`));
    }
    const previous = t > 0 ? str(forms, at(termForm, t - 1)) : '';
    if (t > 0 && !(previous < str(forms, canonical))) return err(corrupt('term order'));
    for (let e = at(adjStart, t); e < at(adjStart, t + 1); e += 1) {
      const other = at(adj, e);
      if (findRelation(adjStart, adj, adjMask, other, t) !== at(adjMask, e))
        return err(corrupt('relation symmetry'));
    }
  }

  return ok({
    bytes,
    version: version as LexiconVersion,
    definitionHash: definitionHash as DefinitionHash,
    profileKind,
    profileId,
    maxFormLength,
    formCount,
    termCount,
    categories,
    termIds,
    terms,
    termForm,
    formTerm,
    formKind,
    adjStart,
    adj,
    adjMask,
    letters,
    nodes,
    edges,
    forms,
  });
}

/** True when `bytes[from, to)` are all zero. */
function zero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (at(bytes, i) !== 0) return false;
  return true;
}

/** Relation mask stored in row `from` for neighbour `to` (binary search in the CSR row), 0 when absent. */
function findRelation(
  starts: Uint32Array,
  list: Uint32Array,
  masks: Uint8Array,
  from: number,
  to: number,
): number {
  let lo = at(starts, from);
  let hi = at(starts, from + 1) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const value = at(list, mid);
    if (value === to) return at(masks, mid);
    if (value < to) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}

/** Depth-first enumeration with an explicit stack; returns an error description, or undefined. */
function enumerate(
  nodes: Uint32Array,
  edges: Uint32Array,
  limit: number,
  out: string[],
): string | undefined {
  // Stack frames: node, next arc code to try, rank of the prefix, prefix.
  const stack: { node: number; code: number; rank: number; prefix: string }[] = [
    { node: 0, code: -1, rank: 0, prefix: '' },
  ];
  // A valid DAWG pushes at most one frame per letter of each form: anything more is a corrupt (or hostile) graph.
  let budget = limit * MAX_FORM_LENGTH + 1;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as (typeof stack)[number];
    const word = at(nodes, frame.node * 2);
    if (frame.code === -1) {
      frame.code = 0;
      if ((word & FINAL_BIT) !== 0) {
        if (frame.prefix.length < 2 || frame.rank !== out.length) return 'final node';
        out.push(frame.prefix);
        if (out.length > limit) return 'form count';
      }
    }
    const mask = word & ARC_MASK;
    let code = frame.code;
    while (code < LETTER_COUNT && (mask & (1 << code)) === 0) code += 1;
    if (code >= LETTER_COUNT) {
      stack.pop();
      continue;
    }
    frame.code = code + 1;
    if (frame.prefix.length >= MAX_FORM_LENGTH) return 'form length';
    budget -= 1;
    if (budget < 0) return 'paths';
    const edge = at(nodes, frame.node * 2 + 1) + popcount(mask & ((1 << code) - 1));
    stack.push({
      node: at(edges, edge * 2),
      code: -1,
      rank: frame.rank + at(edges, edge * 2 + 1),
      prefix: frame.prefix + String.fromCharCode(CODE_A + code),
    });
  }
  return undefined;
}

/** Decodes and validates a `.clxi` artefact; see `decodeLexiconIndex` in `../decode.ts`. */
export function decodeFormat1(
  input: Uint8Array,
  expect?: LexiconIndexExpectation,
): Result<LexiconIndex, LexiconIndexError> {
  const read = readModel(input);
  if (!read.ok) return read;
  const m = read.value;
  if (expect?.version !== undefined && expect.version !== m.version) {
    return err(
      indexError('VERSION_MISMATCH', 'artefact lexiconVersion differs from the expected one', {
        expected: expect.version,
        actual: m.version,
      }),
    );
  }
  if (expect?.profileId !== undefined && expect.profileId !== m.profileId) {
    return err(
      indexError('PROFILE_MISMATCH', 'artefact profile differs from the expected one', {
        expected: expect.profileId,
        actual: m.profileId,
      }),
    );
  }
  return ok(createBinaryIndex(m));
}

function createBinaryIndex(m: Model): LexiconIndex {
  const { nodes, edges, terms } = m;
  const termMetaCache = new Map<number, TermMeta>();
  const formMetaCache = new Map<number, FormMeta>();
  const categories = Object.freeze([...m.categories]);

  /** Cursor in the DAWG: node, and rank of the prefix read so far. Reused to avoid allocations. */
  const cursor = { node: 0, rank: 0 };

  /** Follows `length` codes read through `codeAt` from `cursor`; false when an arc is missing or a code is bad. */
  function advance(length: number, codeAt: (i: number) => number): boolean {
    let { node, rank } = cursor;
    for (let i = 0; i < length; i += 1) {
      const code = codeAt(i);
      if (!(code >= 0 && code < LETTER_COUNT)) return false;
      const mask = at(nodes, node * 2) & ARC_MASK;
      const bit = 1 << code;
      if ((mask & bit) === 0) return false;
      const edge = at(nodes, node * 2 + 1) + popcount(mask & (bit - 1));
      rank += at(edges, edge * 2 + 1);
      node = at(edges, edge * 2);
    }
    cursor.node = node;
    cursor.rank = rank;
    return true;
  }

  const isFinal = (node: number): boolean => (at(nodes, node * 2) & FINAL_BIT) !== 0;

  /** FormRef of the `length` codes read through `codeAt`, or undefined. */
  function walk(length: number, codeAt: (i: number) => number): FormRef | undefined {
    if (length < 2 || length > MAX_FORM_LENGTH) return undefined;
    cursor.node = 0;
    cursor.rank = 0;
    if (!advance(length, codeAt)) return undefined;
    return isFinal(cursor.node) ? (cursor.rank as FormRef) : undefined;
  }

  function lookup(form: string): FormRef | undefined {
    if (typeof form !== 'string') return undefined;
    return walk(form.length, (i) => form.charCodeAt(i) - CODE_A);
  }

  function checkTerm(term: TermRef): number {
    if (!(Number.isInteger(term) && term >= 0 && term < m.termCount)) {
      throw new RangeError(`unknown TermRef ${String(term)}`);
    }
    return term;
  }
  function checkForm(form: FormRef): number {
    if (!(Number.isInteger(form) && form >= 0 && form < m.formCount)) {
      throw new RangeError(`unknown FormRef ${String(form)}`);
    }
    return form;
  }

  const difficultyOf = (t: number): Difficulty =>
    DIFFICULTIES[at(terms, t * TERM_FIELDS) & 0xff] ?? 'novice';

  const relatedMask = (a: number, b: number): RelationMask =>
    findRelation(m.adjStart, m.adj, m.adjMask, a, b);

  /** Codes from an ArrayLike, or undefined when one is not a LetterCode. */
  const codesOk = (codes: ArrayLike<LetterCode>): boolean => {
    for (let i = 0; i < codes.length; i += 1) {
      const c = codes[i];
      if (c === undefined || !Number.isInteger(c) || c < 0 || c >= LETTER_COUNT) return false;
    }
    return true;
  };

  const index: LexiconIndex = {
    version: m.version,
    profile: Object.freeze({
      id: m.profileId,
      kind: m.profileKind,
      definitionHash: m.definitionHash,
    }),
    formatVersion: FORMAT_VERSION,
    size: m.formCount,
    termCount: m.termCount,
    maxFormLength: m.maxFormLength,

    has: (form) => lookup(form) !== undefined,
    lookup,
    lookupCodes(codes, from, to) {
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < from ||
        to > codes.length
      ) {
        return undefined;
      }
      return walk(to - from, (i) => {
        const c = codes[from + i];
        return c !== undefined && Number.isInteger(c) ? c : -1;
      });
    },

    termOf: (form) => at(m.formTerm, checkForm(form)) as TermRef,
    formMeta(form) {
      const f = checkForm(form);
      const cached = formMetaCache.get(f);
      if (cached !== undefined) return cached;
      const meta: FormMeta = Object.freeze({
        ref: form,
        form: str(m.forms, f),
        term: at(m.formTerm, f) as TermRef,
        kind: FORM_KINDS[at(m.formKind, f)] ?? 'canonical',
      });
      formMetaCache.set(f, meta);
      return meta;
    },

    meta(term) {
      const t = checkTerm(term);
      const cached = termMetaCache.get(t);
      if (cached !== undefined) return cached;
      const base = t * TERM_FIELDS;
      const primary = at(terms, base) >>> 8;
      const mask = at(terms, base + 1);
      const cats: CategoryId[] = [categories[primary] as CategoryId];
      categories.forEach((c, i) => {
        if (i !== primary && (mask & (1 << i)) !== 0) cats.push(c);
      });
      const meta: TermMeta = Object.freeze({
        ref: term,
        id: str(m.termIds, t),
        form: str(m.forms, at(m.termForm, t)),
        difficulty: difficultyOf(t),
        categories: Object.freeze(cats),
        gameValue: at(terms, base + 2),
        knowledgeXp: at(terms, base + 3),
      });
      termMetaCache.set(t, meta);
      return meta;
    },
    difficulty: (term) => difficultyOf(checkTerm(term)),
    inCategory(term, category) {
      const t = checkTerm(term);
      const i = categories.indexOf(category);
      return i !== -1 && (at(terms, t * TERM_FIELDS + 1) & (1 << i)) !== 0;
    },
    categories: () => categories,

    related(a, b) {
      const x = checkTerm(a);
      const y = checkTerm(b);
      return x === y ? 0 : relatedMask(x, y);
    },
    neighbours(term) {
      const t = checkTerm(term);
      return Object.freeze(
        Array.from(m.adj.subarray(at(m.adjStart, t), at(m.adjStart, t + 1))) as TermRef[],
      );
    },

    letterCounts: (): LetterCounts => Uint32Array.from(m.letters),

    gaddag: undefined,
    crossCheck(before, after): LetterMask {
      if (!codesOk(before) || !codesOk(after)) return 0;
      const length = before.length + 1 + after.length;
      if (length < 2 || length > MAX_FORM_LENGTH) return 0;
      // Walk the prefix once, then branch on each arc leaving that node and follow the suffix.
      cursor.node = 0;
      cursor.rank = 0;
      if (!advance(before.length, (i) => before[i] ?? -1)) return 0;
      const origin = cursor.node;
      const arcs = at(nodes, origin * 2) & ARC_MASK;
      let mask = 0;
      for (let code = 0; code < LETTER_COUNT; code += 1) {
        const bit = 1 << code;
        if ((arcs & bit) === 0) continue;
        cursor.node = at(edges, (at(nodes, origin * 2 + 1) + popcount(arcs & (bit - 1))) * 2);
        if (advance(after.length, (i) => after[i] ?? -1) && isFinal(cursor.node)) mask |= bit;
      }
      return mask;
    },
  };
  return Object.freeze(index);
}
