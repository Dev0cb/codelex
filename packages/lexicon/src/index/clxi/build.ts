/**
 * `.clxi` builder (lexicon-index note §3.1–§3.3, sprint L4). Pure: same input ⇒ same bytes (§4.3).
 *
 * The canonical model (forms, terms, relations, letter counts) is the reference index of sprint L3, so the binary
 * artefact and the test oracle share one interpretation of the source; this module only lays it out. The
 * GADDAG section (T6) is not built yet: `flags` = 0 and `gaddag` decodes as undefined.
 *
 * Profiles: only the whole playable set (`global` kind) is resolved here; season/org set expressions (T-PROFILE)
 * arrive with `data/profiles/*.json`.
 */
import { err, ok, type Result } from '@codelex/config/result';
import { DIFFICULTIES, FORM_KINDS, LETTER_COUNT } from '../constants.js';
import { createReferenceIndex, type ReferenceTermInput } from '../reference.js';
import type { FormRef, LexiconIndex, TermRef } from '../types.js';
import { crc32 } from './crc32.js';
import {
  align8,
  at,
  CRC_OFFSET,
  FINAL_BIT,
  FIRST_SECTION_OFFSET,
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
  };
  /** Canonical document D (`lexiconContentDocument(lex)`), validated by `pnpm lexicon:validate`. */
  readonly document: { readonly terms: readonly ReferenceTermInput[] };
  /** Forms that must never reach an artefact (second layer after the validator, note §4.4). */
  readonly blocklist?: readonly string[];
}

export interface LexiconBuildOptions {
  readonly formatVersion: 1;
  /** GADDAG section (T6); only `false` is supported by this build (`true` → LIMIT_EXCEEDED). */
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

// --- DAWG -------------------------------------------------------------------------------------------------

interface TrieNode {
  final: boolean;
  /** Child per letter code 0..25 (sparse). */
  readonly children: (TrieNode | undefined)[];
}

const newTrieNode = (): TrieNode => ({ final: false, children: [] });

export interface Dawg {
  /** Per node: arcMask | final << 31, firstEdge. */
  readonly nodes: Uint32Array;
  /** Per edge: target, rank. */
  readonly edges: Uint32Array;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/**
 * Minimal DAWG of `forms` (A–Z strings, sorted, unique), numbered root 0 then breadth-first with arcs ascending.
 * Minimisation: bottom-up merge of nodes with equal (final, arcs → canonical child) signatures.
 */
export function buildDawg(forms: readonly string[]): Dawg {
  const root = newTrieNode();
  for (const form of forms) {
    let node = root;
    for (let i = 0; i < form.length; i += 1) {
      const code = form.charCodeAt(i) - 65;
      let child = node.children[code];
      if (child === undefined) {
        child = newTrieNode();
        node.children[code] = child;
      }
      node = child;
    }
    node.final = true;
  }

  // Bottom-up canonicalisation (post-order); ids here are temporary.
  const registry = new Map<string, number>();
  const canonical: { final: boolean; arcs: [number, number][] }[] = [];
  const canonicalOf = new Map<TrieNode, number>();
  const visit = (node: TrieNode): number => {
    const known = canonicalOf.get(node);
    if (known !== undefined) return known;
    const arcs: [number, number][] = [];
    for (let code = 0; code < LETTER_COUNT; code += 1) {
      const child = node.children[code];
      if (child !== undefined) arcs.push([code, visit(child)]);
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

  // Word counts per canonical node (for ranks).
  const words = new Array<number>(canonical.length).fill(-1);
  const countWords = (id: number): number => {
    const cached = words[id] ?? -1;
    if (cached >= 0) return cached;
    const node = canonical[id] as (typeof canonical)[number];
    let n = node.final ? 1 : 0;
    for (const [, target] of node.arcs) n += countWords(target);
    words[id] = n;
    return n;
  };
  countWords(rootTemp);

  // Deterministic numbering: breadth-first from the root, arcs ascending.
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
  const edgeCount = order.reduce((sum, id) => sum + (canonical[id]?.arcs.length ?? 0), 0);
  const nodes = new Uint32Array(order.length * 2);
  const edges = new Uint32Array(edgeCount * 2);
  let edge = 0;
  order.forEach((id, index) => {
    const node = canonical[id] as (typeof canonical)[number];
    let mask = 0;
    let rank = node.final ? 1 : 0;
    nodes[index * 2 + 1] = edge;
    for (const [code, target] of node.arcs) {
      mask |= 1 << code;
      edges[edge * 2] = finalId.get(target) ?? 0;
      edges[edge * 2 + 1] = rank;
      rank += at(words, target);
      edge += 1;
    }
    nodes[index * 2] = (mask | (node.final ? FINAL_BIT : 0)) >>> 0;
  });
  return { nodes, edges, nodeCount: order.length, edgeCount };
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

function encode(index: LexiconIndex, input: LexiconBuildInput): Uint8Array {
  const forms = Array.from({ length: index.size }, (_, i) => index.formMeta(i as FormRef));
  const dawg = buildDawg(forms.map((f) => f.form));
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
  view.setUint16(6, 0, true);
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
 * Builds a `.clxi` artefact. Errors: `VALIDATION_FAILED` (source breaks an index invariant, or a malformed
 * version/profile), `BLOCKLISTED_FORM`, `EMPTY_PROFILE`, `LIMIT_EXCEEDED` (> 32 categories, non-ASCII ids,
 * values outside u16, unsupported options).
 */
export function buildLexiconIndex(
  input: LexiconBuildInput,
  options: LexiconBuildOptions,
): Result<Uint8Array, LexiconBuildError> {
  if ((options.formatVersion as number) !== FORMAT_VERSION || options.gaddag) {
    return err(buildError('LIMIT_EXCEEDED', 'only formatVersion 1 without GADDAG is supported'));
  }
  if (!HEX16.test(input.version)) return err(buildError('VALIDATION_FAILED', 'bad lexiconVersion'));
  if (!HEX16.test(input.profile.definitionHash) || !ASCII_ID.test(input.profile.id)) {
    return err(buildError('VALIDATION_FAILED', 'bad profile reference'));
  }
  if (!PROFILE_KINDS.includes(input.profile.kind)) {
    return err(buildError('UNKNOWN_PROFILE_REFERENCE', 'unknown profile kind'));
  }
  let index: LexiconIndex;
  try {
    index = createReferenceIndex({
      version: input.version as LexiconIndex['version'],
      profile: input.profile as LexiconIndex['profile'],
      document: input.document,
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
  return ok(encode(index, input));
}
