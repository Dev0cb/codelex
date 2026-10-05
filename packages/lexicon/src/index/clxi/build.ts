/**
 * `.clxi` builder (lexicon-index note §3.1–§3.3, sprint L4). Pure: same input ⇒ same bytes (§4.3).
 *
 * The canonical model (forms, terms, relations, letter counts) is the reference index of sprint L3, so the binary
 * artefact and the test oracle share one interpretation of the source; this module only lays it out. The
 * GADDAG sections (T6, sprint L5) are built when `options.gaddag` is true (header flags bit 0); otherwise they
 * are empty, flags = 0 and `gaddag` decodes as undefined.
 *
 * Profiles: only the whole playable set (`global` kind) is resolved here, with the `inflections: all | none`
 * option (E-1.7 D-14, sprint 3 P8); season/org set expressions (T-PROFILE)
 * arrive with `data/profiles/*.json`.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { DIFFICULTIES, FORM_KINDS, GADDAG_SEPARATOR, LETTER_COUNT } from '../constants.js';
import { createReferenceIndex, type ReferenceTermInput } from '../reference.js';
import { decodeLexiconIndex } from '../decode.js';
import type { FormRef, LexiconIndex, LexiconVersion, TermRef } from '../types.js';
import { crc32 } from './crc32.js';
import {
  align8,
  at,
  CRC_OFFSET,
  FINAL_BIT,
  FIRST_SECTION_OFFSET,
  FLAG_GADDAG,
  FORMAT_VERSION,
  MAX_CATEGORIES,
  PROFILE_KINDS,
  SECTION_COUNT,
  SECTION_TABLE_OFFSET,
  SECTIONS,
  type SectionName,
} from './format.js';

export type LexiconBuildErrorCode =
  | 'VALIDATION_FAILED'
  | 'BLOCKLISTED_FORM'
  | 'EMPTY_PROFILE'
  | 'UNKNOWN_PROFILE_REFERENCE'
  | 'LIMIT_EXCEEDED';

export interface LexiconBuildError {
  readonly code: LexiconBuildErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

export interface LexiconBuildInput {
  /** `computeLexiconVersion(lex)` of the validated source. */
  readonly version: string;
  readonly profile: {
    readonly id: string;
    readonly kind: (typeof PROFILE_KINDS)[number];
    /** 16 lowercase hex chars. */
    readonly definitionHash: string;
    /**
     * Profile option `inflections` (E-1.7 D-14, lexicon-index note §4.2): `all` (default, also when absent)
     * keeps every declared inflection; `none` builds canonical forms only. Build-time only and covered by
     * `definitionHash` (`profileBuildInput` in scripts/canonical.mjs derives both from one definition); no
     * header field and no runtime switch, so the format and the default artefacts are unchanged.
     */
    readonly inflections?: InflectionPolicy | undefined;
  };
  /** Canonical document D (`lexiconContentDocument(lex)`), validated by `pnpm lexicon:validate`. */
  readonly document: { readonly terms: readonly ReferenceTermInput[] };
  /** Forms that must never reach an artefact (second layer after the validator, note §4.4). */
  readonly blocklist?: readonly string[];
}

/** Values of the profile option `inflections` (E-1.7 D-14). */
export const INFLECTION_POLICIES = Object.freeze(['all', 'none'] as const);
export type InflectionPolicy = (typeof INFLECTION_POLICIES)[number];

export interface LexiconBuildOptions {
  readonly formatVersion: 1;
  /** Include the GADDAG sections (T6, header flags bit 0). Mobile builds may omit them (note §5 size gate). */
  readonly gaddag: boolean;
}

const HEX16 = /^[0-9a-f]{16}$/;
const ASCII_ID = /^[\x21-\x7e]{1,255}$/;
const U16_MAX = 0xffff;

function buildError(
  code: LexiconBuildErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number>>,
): LexiconBuildError {
  return details === undefined ? { code, message } : { code, message, details };
}

// --- automata (DAWG, GADDAG) ------------------------------------------------------------------------------

interface TrieNode {
  final: boolean;
  /** Child per symbol (sparse). */
  readonly children: (TrieNode | undefined)[];
}

const newTrieNode = (): TrieNode => ({ final: false, children: [] });

function insert(root: TrieNode, symbols: readonly number[]): void {
  let node = root;
  for (const symbol of symbols) {
    let child = node.children[symbol];
    if (child === undefined) {
      child = newTrieNode();
      node.children[symbol] = child;
    }
    node = child;
  }
  node.final = true;
}

interface MinimalNode {
  readonly final: boolean;
  /** (symbol, final node id), symbols ascending. */
  readonly arcs: readonly (readonly [number, number])[];
}

/**
 * Minimal automaton of a trie over symbols 0..alphabet−1: bottom-up merge of nodes with equal (final,
 * arcs → canonical child) signatures, then numbering root 0 and breadth-first with arcs ascending (§4.3).
 */
function minimise(root: TrieNode, alphabet: number): MinimalNode[] {
  const registry = new Map<string, number>();
  const canonical: { final: boolean; arcs: [number, number][] }[] = [];
  const canonicalOf = new Map<TrieNode, number>();
  const visit = (node: TrieNode): number => {
    const known = canonicalOf.get(node);
    if (known !== undefined) return known;
    const arcs: [number, number][] = [];
    for (let symbol = 0; symbol < alphabet; symbol += 1) {
      const child = node.children[symbol];
      if (child !== undefined) arcs.push([symbol, visit(child)]);
    }
    const signature = `${node.final ? 'F' : 'N'}|${arcs.map(([c, t]) => `${String(c)}:${String(t)}`).join(',')}`;
    let id = registry.get(signature);
    if (id === undefined) {
      id = canonical.length;
      canonical.push({ final: node.final, arcs });
      registry.set(signature, id);
    }
    canonicalOf.set(node, id);
    return id;
  };
  const rootTemp = visit(root);
  const order: number[] = [rootTemp];
  const finalId = new Map<number, number>([[rootTemp, 0]]);
  for (let i = 0; i < order.length; i += 1) {
    for (const [, target] of (canonical[order[i] as number] as (typeof canonical)[number]).arcs) {
      if (!finalId.has(target)) {
        finalId.set(target, order.length);
        order.push(target);
      }
    }
  }
  return order.map((id) => {
    const node = canonical[id] as (typeof canonical)[number];
    return {
      final: node.final,
      arcs: node.arcs.map(([symbol, target]) => [symbol, finalId.get(target) ?? 0] as const),
    };
  });
}

const codesOfForm = (form: string): number[] =>
  Array.from({ length: form.length }, (_, i) => form.charCodeAt(i) - 65);

/** Minimal DAWG tables (format.ts DAWG_NODES / DAWG_EDGES). */
export interface DawgTables {
  /** Per node: arcMask | final << 31, firstEdge. */
  readonly nodes: Uint32Array;
  /** Per edge: target, rank. */
  readonly edges: Uint32Array;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/** Minimal DAWG of `forms` (A–Z strings, sorted, unique), numbered root 0 then breadth-first with arcs ascending. */
export function buildDawg(forms: readonly string[]): DawgTables {
  const root = newTrieNode();
  for (const form of forms) insert(root, codesOfForm(form));
  const minimal = minimise(root, LETTER_COUNT);

  // Words below each node (for ranks), children before parents: reverse topological order is not the BFS
  // order, so memoise recursively (depth ≤ 15).
  const words = new Array<number>(minimal.length).fill(-1);
  const countWords = (id: number): number => {
    const cached = at(words, id);
    if (cached >= 0) return cached;
    const node = minimal[id] as MinimalNode;
    let n = node.final ? 1 : 0;
    for (const [, target] of node.arcs) n += countWords(target);
    words[id] = n;
    return n;
  };
  countWords(0);

  const edgeCount = minimal.reduce((sum, node) => sum + node.arcs.length, 0);
  const nodes = new Uint32Array(minimal.length * 2);
  const edges = new Uint32Array(edgeCount * 2);
  let edge = 0;
  minimal.forEach((node, index) => {
    let mask = 0;
    let rank = node.final ? 1 : 0;
    nodes[index * 2 + 1] = edge;
    for (const [code, target] of node.arcs) {
      mask |= 1 << code;
      edges[edge * 2] = target;
      edges[edge * 2 + 1] = rank;
      rank += at(words, target);
      edge += 1;
    }
    nodes[index * 2] = (mask | (node.final ? FINAL_BIT : 0)) >>> 0;
  });
  return { nodes, edges, nodeCount: minimal.length, edgeCount };
}

/** Minimal GADDAG tables (format.ts GADDAG_NODES / GADDAG_EDGES). */
export interface GaddagTables {
  /** Per node: arcMask (bits 0..26) | final << 31, firstEdge. */
  readonly nodes: Uint32Array;
  /** Per edge: target. */
  readonly edges: Uint32Array;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/**
 * The GADDAG paths of one form (lexicon-index note §2.3): rev(w), then rev(w[0..i]) ◇ w[i..n] for i = 1..n−1.
 * Exported for tests (T-GADDAG enumerates exactly these).
 */
export function gaddagPaths(form: string): number[][] {
  const codes = codesOfForm(form);
  const paths: number[][] = [[...codes].reverse()];
  for (let i = 1; i < codes.length; i += 1) {
    paths.push([...codes.slice(0, i).reverse(), GADDAG_SEPARATOR, ...codes.slice(i)]);
  }
  return paths;
}

/** Minimal GADDAG of `forms` (A–Z strings, unique), numbered root 0 then breadth-first with arcs ascending. */
export function buildGaddag(forms: readonly string[]): GaddagTables {
  const root = newTrieNode();
  for (const form of forms) for (const path of gaddagPaths(form)) insert(root, path);
  const minimal = minimise(root, GADDAG_SEPARATOR + 1);
  const edgeCount = minimal.reduce((sum, node) => sum + node.arcs.length, 0);
  const nodes = new Uint32Array(minimal.length * 2);
  const edges = new Uint32Array(edgeCount);
  let edge = 0;
  minimal.forEach((node, index) => {
    let mask = 0;
    nodes[index * 2 + 1] = edge;
    for (const [symbol, target] of node.arcs) {
      mask |= 1 << symbol;
      edges[edge] = target;
      edge += 1;
    }
    nodes[index * 2] = (mask | (node.final ? FINAL_BIT : 0)) >>> 0;
  });
  return { nodes, edges, nodeCount: minimal.length, edgeCount };
}

// --- encoder ----------------------------------------------------------------------------------------------

class Writer {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  /** Appends `bytes` at the next 8-byte boundary; returns its offset (absolute, given the header base). */
  append(bytes: Uint8Array, base: number): number {
    const padding = align8(base + this.length) - (base + this.length);
    if (padding > 0) this.chunks.push(new Uint8Array(padding));
    this.length += padding;
    const offset = base + this.length;
    this.chunks.push(bytes);
    this.length += bytes.length;
    return offset;
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

function u32Bytes(values: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i += 1) view.setUint32(i * 4, values[i] ?? 0, true);
  return bytes;
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

class StringPool {
  private text = '';
  add(value: string): [number, number] {
    const offset = this.text.length;
    this.text += value;
    return [offset, value.length];
  }
  bytes(): Uint8Array {
    return asciiBytes(this.text);
  }
}

function encode(
  index: LexiconIndex,
  input: LexiconBuildInput,
  options: LexiconBuildOptions,
): Uint8Array {
  const forms = Array.from({ length: index.size }, (_, i) => index.formMeta(i as FormRef));
  const dawg = buildDawg(forms.map((f) => f.form));
  const gaddag = options.gaddag ? buildGaddag(forms.map((f) => f.form)) : undefined;
  const categories = index.categories();
  const categoryIndex = new Map<string, number>(categories.map((c, i) => [c, i]));

  const pool = new StringPool();
  const [profileOffset, profileLength] = pool.add(input.profile.id);
  const categoryRefs: number[] = [];
  for (const category of categories) categoryRefs.push(...pool.add(category));

  const terms: number[] = [];
  const termForm: number[] = [];
  const adjStart: number[] = [0];
  const adj: number[] = [];
  const adjMask: number[] = [];
  for (let t = 0; t < index.termCount; t += 1) {
    const term = t as TermRef;
    const meta = index.meta(term);
    const primary = categoryIndex.get(meta.categories[0] ?? '') ?? 0;
    let mask = 0;
    for (const c of meta.categories) mask |= 1 << (categoryIndex.get(c) ?? 0);
    const [idOffset, idLength] = pool.add(meta.id);
    terms.push(
      DIFFICULTIES.indexOf(meta.difficulty) | (primary << 8),
      mask >>> 0,
      meta.gameValue,
      meta.knowledgeXp,
      idOffset,
      idLength,
    );
    termForm.push(index.lookup(meta.form) ?? 0);
    for (const neighbour of index.neighbours(term)) {
      adj.push(neighbour);
      adjMask.push(index.related(term, neighbour));
    }
    adjStart.push(adj.length);
  }

  const sections: Record<SectionName, Uint8Array> = {
    META: u32Bytes([
      index.size,
      index.termCount,
      categories.length,
      profileOffset,
      profileLength,
      dawg.nodeCount,
      dawg.edgeCount,
      gaddag?.nodeCount ?? 0,
      gaddag?.edgeCount ?? 0,
    ]),
    STRINGS: pool.bytes(),
    CATEGORIES: u32Bytes(categoryRefs),
    TERMS: u32Bytes(terms),
    TERM_FORM: u32Bytes(termForm),
    FORM_TERM: u32Bytes(forms.map((f) => f.term)),
    FORM_KIND: Uint8Array.from(forms.map((f) => FORM_KINDS.indexOf(f.kind))),
    ADJ_START: u32Bytes(adjStart),
    ADJ: u32Bytes(adj),
    ADJ_MASK: Uint8Array.from(adjMask),
    LETTERS: u32Bytes(index.letterCounts()),
    DAWG_NODES: u32Bytes(dawg.nodes),
    DAWG_EDGES: u32Bytes(dawg.edges),
    GADDAG_NODES: gaddag === undefined ? new Uint8Array(0) : u32Bytes(gaddag.nodes),
    GADDAG_EDGES: gaddag === undefined ? new Uint8Array(0) : u32Bytes(gaddag.edges),
  };

  const writer = new Writer();
  const table: number[] = [];
  for (const name of SECTIONS) {
    const bytes = sections[name];
    table.push(writer.append(bytes, FIRST_SECTION_OFFSET), bytes.length);
  }
  const body = writer.concat();
  const out = new Uint8Array(FIRST_SECTION_OFFSET + align8(body.length));
  out.set(body, FIRST_SECTION_OFFSET);

  const view = new DataView(out.buffer);
  out.set(asciiBytes('CLXI'), 0);
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, options.gaddag ? FLAG_GADDAG : 0, true);
  out.set(asciiBytes(input.version), 8);
  out.set(asciiBytes(input.profile.definitionHash), 24);
  out[40] = PROFILE_KINDS.indexOf(input.profile.kind);
  out[41] = index.maxFormLength;
  view.setUint32(48, SECTION_COUNT, true);
  table.forEach((value, i) => {
    view.setUint32(SECTION_TABLE_OFFSET + i * 4, value, true);
  });
  const crc = crc32(out, 0, CRC_OFFSET, 0);
  view.setUint32(CRC_OFFSET, crc32(out, CRC_OFFSET + 4, out.length, crc), true);
  return out;
}

/**
 * Builds a `.clxi` artefact. Errors: `VALIDATION_FAILED` (source breaks an index invariant, a malformed
 * version/profile, or the artefact fails its own decoder — `checkBuiltArtefact`),`BLOCKLISTED_FORM`, `EMPTY_PROFILE`, `LIMIT_EXCEEDED` (> 32 categories, non-ASCII ids,
 * values outside u16, unsupported options).
 */
export function buildLexiconIndex(
  input: LexiconBuildInput,
  options: LexiconBuildOptions,
): Result<Uint8Array, LexiconBuildError> {
  if ((options.formatVersion as number) !== FORMAT_VERSION) {
    return err(buildError('LIMIT_EXCEEDED', 'only formatVersion 1 is supported'));
  }
  if (!HEX16.test(input.version)) return err(buildError('VALIDATION_FAILED', 'bad lexiconVersion'));
  if (!HEX16.test(input.profile.definitionHash) || !ASCII_ID.test(input.profile.id)) {
    return err(buildError('VALIDATION_FAILED', 'bad profile reference'));
  }
  if (!PROFILE_KINDS.includes(input.profile.kind)) {
    return err(buildError('UNKNOWN_PROFILE_REFERENCE', 'unknown profile kind'));
  }
  const policy = input.profile.inflections ?? 'all';
  if (!INFLECTION_POLICIES.includes(policy)) {
    return err(buildError('VALIDATION_FAILED', 'unknown profile option inflections'));
  }
  // `all` passes the document through untouched, so default artefacts keep their bytes (sprint 3 P8).
  const document =
    policy === 'all'
      ? input.document
      : { terms: input.document.terms.map((t) => ({ ...t, inflections: [] })) };
  let index: LexiconIndex;
  try {
    index = createReferenceIndex({
      version: input.version as LexiconIndex['version'],
      profile: {
        id: input.profile.id,
        kind: input.profile.kind,
        definitionHash: input.profile.definitionHash,
      } as LexiconIndex['profile'],
      document,
    });
  } catch (e) {
    return err(
      buildError('VALIDATION_FAILED', e instanceof RangeError ? e.message : 'invalid source'),
    );
  }
  if (index.size === 0) return err(buildError('EMPTY_PROFILE', 'the profile has no playable form'));

  const blocked = new Set(input.blocklist ?? []);
  for (let i = 0; i < index.size; i += 1) {
    const { form } = index.formMeta(i as FormRef);
    if (blocked.has(form)) {
      return err(buildError('BLOCKLISTED_FORM', 'a playable form is blocklisted', { form }));
    }
  }
  if (index.categories().length > MAX_CATEGORIES) {
    return err(
      buildError('LIMIT_EXCEEDED', 'more than 32 categories', { count: index.categories().length }),
    );
  }
  for (const category of index.categories()) {
    if (!ASCII_ID.test(category)) return err(buildError('LIMIT_EXCEEDED', 'non-ASCII category id'));
  }
  for (let t = 0; t < index.termCount; t += 1) {
    const meta = index.meta(t as TermRef);
    if (!ASCII_ID.test(meta.id)) {
      return err(buildError('LIMIT_EXCEEDED', 'non-ASCII term id', { term: t }));
    }
    if (
      meta.gameValue < 0 ||
      meta.gameValue > U16_MAX ||
      meta.knowledgeXp < 0 ||
      meta.knowledgeXp > U16_MAX
    ) {
      return err(
        buildError('LIMIT_EXCEEDED', 'gameValue/knowledgeXp outside u16', { id: meta.id }),
      );
    }
  }
  return checkBuiltArtefact(encode(index, input, options), input);
}

/**
 * Self-check of a freshly built artefact: it must decode with its own decoder and match the requested version
 * and profile; otherwise the build fails with `VALIDATION_FAILED` (details: `decodeError`, and `what` for
 * CORRUPT) instead of publishing bytes that every loader would reject. Exported for tests.
 */
export function checkBuiltArtefact(
  bytes: Uint8Array,
  input: Pick<LexiconBuildInput, 'version' | 'profile'>,
): Result<Uint8Array, LexiconBuildError> {
  const decoded = decodeLexiconIndex(bytes, {
    version: input.version as LexiconVersion,
    profileId: input.profile.id,
  });
  if (decoded.ok) return ok(bytes);
  return err(
    buildError(
      'VALIDATION_FAILED',
      `built artefact fails its own decoder: ${decoded.error.message}`,
      {
        decodeError: decoded.error.code,
        ...decoded.error.details,
      },
    ),
  );
}
