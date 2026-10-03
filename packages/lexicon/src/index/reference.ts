/**
 * Reference `LexiconIndex` (sprint L3): a `Map`/`Set`-backed implementation of the contract, built from the
 * canonical content document D of ADR-0013 §D7 (`lexiconContentDocument()` in `scripts/canonical.mjs`). It is
 * the test oracle of the binary `.clxi` index (L4, T-ORACLE) and lets the engine (E2–E4) and the bots run against
 * real data before L4 lands. It favours obviousness over speed: `lookupCodes` builds a string, and `dawg` /
 * `gaddag` are plain (unminimised) tries over the forms and their GADDAG paths, built on first access, so that
 * the minimal automata of the binary index are checked against an independent construction (T-GADDAG).
 *
 * Profile: the whole playable set (`global` profile). Season/org profile resolution arrives with L4 (T-PROFILE).
 */
import {
  DIFFICULTIES,
  GADDAG_SEPARATOR,
  LETTER_COUNT,
  MAX_FORM_LENGTH,
  relationBit,
} from './constants.js';
import type {
  CategoryId,
  Dawg,
  DawgNode,
  Difficulty,
  FormKind,
  FormMeta,
  FormRef,
  Gaddag,
  GaddagNode,
  InflectionKind,
  LetterCode,
  LetterCounts,
  LetterMask,
  LexiconIndex,
  LexiconProfileRef,
  LexiconVersion,
  RelationMask,
  RelationType,
  TermMeta,
  TermRef,
} from './types.js';

/** One term of the canonical document D (ADR-0013 §D7); non-playable terms are ignored. */
export interface ReferenceTermInput {
  readonly id: string;
  readonly playable: boolean;
  readonly form?: string | undefined;
  readonly difficulty?: string | undefined;
  /** First = primary category. */
  readonly categories: readonly string[];
  readonly inflections: readonly { readonly form: string; readonly kind: string }[];
  readonly relations: readonly { readonly type: string; readonly target: string }[];
  /** Effective values (approved override or formula); present on every playable term of D. */
  readonly gameValue?: number | undefined;
  readonly knowledgeXp?: number | undefined;
}

export interface ReferenceIndexInput {
  readonly version: LexiconVersion;
  readonly profile: LexiconProfileRef;
  readonly document: { readonly terms: readonly ReferenceTermInput[] };
  /** Expose a GADDAG (default true); false mimics an artefact without the section (bots' DAWG fallback). */
  readonly gaddag?: boolean;
}

/** `formatVersion` reported by the reference implementation: it has no binary format. */
export const REFERENCE_FORMAT_VERSION = 0;

const FORM_RE = /^[A-Z]{2,15}$/;
const CODE_A = 65;
const INFLECTION_KIND_SET: ReadonlySet<string> = new Set<InflectionKind>([
  'plural',
  'verb_s',
  'verb_ed',
  'verb_ing',
]);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A trie over symbols 0..alphabet−1 behind the `Dawg` / `Gaddag` shape: node = index in `children`; nodes that
 * are not ours are dead ends (`arcs` 0, `next` -1, `isFinal` false), as the contract requires.
 */
function trie(paths: Iterable<readonly number[]>, alphabet: number): Dawg & Gaddag {
  const children: number[][] = [[]];
  const masks: number[] = [0];
  const finals: boolean[] = [false];
  for (const path of paths) {
    let node = 0;
    for (const symbol of path) {
      let child = children[node]?.[symbol];
      if (child === undefined) {
        child = children.length;
        children.push([]);
        masks.push(0);
        finals.push(false);
        (children[node] as number[])[symbol] = child;
        masks[node] = (masks[node] ?? 0) | (1 << symbol);
      }
      node = child;
    }
    finals[node] = true;
  }
  const own = (node: number): boolean => Number.isInteger(node) && node >= 0 && node < masks.length;
  return Object.freeze({
    root: 0 as DawgNode & GaddagNode,
    arcs: (node: number) => (own(node) ? (masks[node] ?? 0) : 0),
    next(node: number, symbol: number) {
      if (!own(node) || !Number.isInteger(symbol) || symbol < 0 || symbol >= alphabet) return -1;
      return (children[node]?.[symbol] ?? -1) as (DawgNode & GaddagNode) | -1;
    },
    isFinal: (node: number) => own(node) && finals[node] === true,
  });
}

const codesOf = (form: string): number[] =>
  Array.from({ length: form.length }, (_, i) => form.charCodeAt(i) - CODE_A);

/** rev(w), then rev(w[0..i]) ◇ w[i..n] for i = 1..n−1 (lexicon-index note §2.3). */
function* gaddagPathsOf(forms: readonly string[]): Generator<number[]> {
  for (const form of forms) {
    const codes = codesOf(form);
    yield [...codes].reverse();
    for (let i = 1; i < codes.length; i += 1) {
      yield [...codes.slice(0, i).reverse(), GADDAG_SEPARATOR, ...codes.slice(i)];
    }
  }
}

function isDifficulty(value: string | undefined): value is Difficulty {
  return value !== undefined && (DIFFICULTIES as readonly string[]).includes(value);
}

interface TermRow {
  readonly id: string;
  readonly form: string;
  readonly difficulty: Difficulty;
  readonly categories: readonly CategoryId[];
  readonly gameValue: number;
  readonly knowledgeXp: number;
}

interface FormRow {
  readonly form: string;
  readonly termId: string;
  readonly kind: FormKind;
}

/**
 * A term's categories as `[primary, ...secondary sorted by code unit]` (the order of document D and of the
 * binary index). Throws `RangeError` on an empty list or a repeated category (LEXICON_SPEC: ≥ 1, unique).
 */
function normaliseCategories(id: string, categories: readonly string[]): readonly CategoryId[] {
  const [primary, ...secondary] = categories;
  if (primary === undefined) throw new RangeError(`term ${id}: no category`);
  if (new Set(categories).size !== categories.length) {
    throw new RangeError(`term ${id}: duplicate category`);
  }
  return [primary, ...[...secondary].sort(byCodeUnit)].map((c) => c as CategoryId);
}

/**
 * Builds the reference index. Throws `RangeError` on a source that breaks the lexicon invariants (duplicate
 * form, invalid form, unknown difficulty or inflection kind, unknown relation type, missing values, an empty or
 * repeated category list): it is
 * meant for validated data (`pnpm lexicon:validate`), so a throw is a bug in the caller or the validator.
 */
export function createReferenceIndex(input: ReferenceIndexInput): LexiconIndex {
  const playable = input.document.terms.filter((t) => t.playable);

  // --- terms, sorted by canonical form (TermRef order) ---
  const termRows: TermRow[] = playable.map((t) => {
    const form = t.form;
    if (form === undefined || !FORM_RE.test(form)) {
      throw new RangeError(`term ${t.id}: invalid form ${String(form)}`);
    }
    if (!isDifficulty(t.difficulty)) {
      throw new RangeError(`term ${t.id}: unknown difficulty ${String(t.difficulty)}`);
    }
    if (!Number.isSafeInteger(t.gameValue) || !Number.isSafeInteger(t.knowledgeXp)) {
      throw new RangeError(`term ${t.id}: gameValue and knowledgeXp must be integers`);
    }
    return {
      id: t.id,
      form,
      difficulty: t.difficulty,
      categories: normaliseCategories(t.id, t.categories),
      gameValue: t.gameValue as number,
      knowledgeXp: t.knowledgeXp as number,
    };
  });
  termRows.sort((a, b) => byCodeUnit(a.form, b.form));
  const termRefById = new Map<string, TermRef>();
  termRows.forEach((row, i) => {
    if (termRefById.has(row.id)) throw new RangeError(`duplicate term id ${row.id}`);
    termRefById.set(row.id, i as TermRef);
  });

  // --- forms (canonical + inflections), sorted by string (FormRef order) ---
  const formRows: FormRow[] = [];
  for (const t of playable) {
    formRows.push({ form: t.form as string, termId: t.id, kind: 'canonical' });
    for (const inflection of t.inflections) {
      if (!FORM_RE.test(inflection.form)) {
        throw new RangeError(`term ${t.id}: invalid inflection ${inflection.form}`);
      }
      if (!INFLECTION_KIND_SET.has(inflection.kind)) {
        throw new RangeError(`term ${t.id}: unknown inflection kind ${inflection.kind}`);
      }
      formRows.push({
        form: inflection.form,
        termId: t.id,
        kind: inflection.kind as InflectionKind,
      });
    }
  }
  formRows.sort((a, b) => byCodeUnit(a.form, b.form));
  const formRefByString = new Map<string, FormRef>();
  const termOfForm: TermRef[] = [];
  formRows.forEach((row, i) => {
    if (formRefByString.has(row.form)) throw new RangeError(`duplicate playable form ${row.form}`);
    formRefByString.set(row.form, i as FormRef);
    termOfForm.push(termRefById.get(row.termId) as TermRef);
  });

  // --- undirected relations between in-profile terms ---
  const relations = termRows.map(() => new Map<TermRef, RelationMask>());
  for (const t of playable) {
    const a = termRefById.get(t.id) as TermRef;
    for (const r of t.relations) {
      const bit = relationBit(r.type as RelationType); // throws on an unknown type
      const b = termRefById.get(r.target);
      if (b === undefined || b === a) continue; // out of profile, or a self-link
      const fromA = relations[a] as Map<TermRef, RelationMask>;
      const fromB = relations[b] as Map<TermRef, RelationMask>;
      fromA.set(b, (fromA.get(b) ?? 0) | bit);
      fromB.set(a, (fromB.get(a) ?? 0) | bit);
    }
  }
  const neighbourLists: readonly TermRef[][] = relations.map((m) =>
    [...m.keys()].sort((x, y) => x - y),
  );

  // --- R-BAG-001 letter counts over every playable form ---
  const counts = new Uint32Array(LETTER_COUNT);
  for (const row of formRows) {
    for (let i = 0; i < row.form.length; i += 1) {
      const code = row.form.charCodeAt(i) - CODE_A;
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }

  const categoryIds: readonly CategoryId[] = Object.freeze(
    [...new Set(termRows.flatMap((r) => r.categories))].sort(byCodeUnit),
  );
  const maxFormLength = formRows.reduce((m, r) => Math.max(m, r.form.length), 0);

  const formStrings = formRows.map((r) => r.form);
  let dawg: Dawg | undefined;
  let gaddag: Gaddag | undefined;
  const withGaddag = input.gaddag ?? true;

  const termMetaCache = new Map<TermRef, TermMeta>();
  const formMetaCache = new Map<FormRef, FormMeta>();

  function termRow(term: TermRef): TermRow {
    const row = termRows[term];
    if (row === undefined) throw new RangeError(`unknown TermRef ${String(term)}`);
    return row;
  }

  function formRow(form: FormRef): FormRow {
    const row = formRows[form];
    if (row === undefined) throw new RangeError(`unknown FormRef ${String(form)}`);
    return row;
  }

  function lookup(form: string): FormRef | undefined {
    if (typeof form !== 'string' || form.length < 2 || form.length > MAX_FORM_LENGTH)
      return undefined;
    return formRefByString.get(form);
  }

  /** Letters of `codes[from, to)`, or undefined if a bound or a code is invalid (no length rule here). */
  function lettersOf(codes: ArrayLike<LetterCode>, from: number, to: number): string | undefined {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from ||
      to > codes.length
    ) {
      return undefined;
    }
    let s = '';
    for (let i = from; i < to; i += 1) {
      const code = codes[i];
      if (code === undefined || !Number.isInteger(code) || code < 0 || code >= LETTER_COUNT) {
        return undefined;
      }
      s += String.fromCharCode(CODE_A + code);
    }
    return s;
  }

  const index: LexiconIndex = {
    version: input.version,
    profile: input.profile,
    formatVersion: REFERENCE_FORMAT_VERSION,
    size: formRows.length,
    termCount: termRows.length,
    maxFormLength,

    has: (form) => lookup(form) !== undefined,
    lookup,
    lookupCodes(codes, from, to) {
      const s = lettersOf(codes, from, to);
      return s === undefined ? undefined : lookup(s);
    },

    termOf(form) {
      formRow(form);
      return termOfForm[form] as TermRef;
    },
    formMeta(form) {
      const cached = formMetaCache.get(form);
      if (cached !== undefined) return cached;
      const row = formRow(form);
      const meta: FormMeta = Object.freeze({
        ref: form,
        form: row.form,
        term: termOfForm[form] as TermRef,
        kind: row.kind,
      });
      formMetaCache.set(form, meta);
      return meta;
    },

    meta(term) {
      const cached = termMetaCache.get(term);
      if (cached !== undefined) return cached;
      const row = termRow(term);
      const meta: TermMeta = Object.freeze({
        ref: term,
        id: row.id,
        form: row.form,
        difficulty: row.difficulty,
        categories: Object.freeze([...row.categories]),
        gameValue: row.gameValue,
        knowledgeXp: row.knowledgeXp,
      });
      termMetaCache.set(term, meta);
      return meta;
    },
    difficulty: (term) => termRow(term).difficulty,
    inCategory: (term, category) => termRow(term).categories.includes(category),
    categories: () => categoryIds,

    related(a, b) {
      termRow(a);
      termRow(b);
      if (a === b) return 0;
      return relations[a]?.get(b) ?? 0;
    },
    neighbours(term) {
      termRow(term);
      return Object.freeze([...(neighbourLists[term] ?? [])]);
    },

    // A fresh copy per call: callers can never alter the index's own counts (T-ORACLE).
    letterCounts: (): LetterCounts => Uint32Array.from(counts),

    // Built on first access (pure: same forms ⇒ same tries), so indexes that never generate moves stay cheap.
    get gaddag(): Gaddag | undefined {
      if (!withGaddag) return undefined;
      gaddag ??= trie(gaddagPathsOf(formStrings), GADDAG_SEPARATOR + 1);
      return gaddag;
    },
    get dawg(): Dawg {
      dawg ??= trie(formStrings.map(codesOf), LETTER_COUNT);
      return dawg;
    },
    crossCheck(before, after): LetterMask {
      const prefix = lettersOf(before, 0, before.length);
      const suffix = lettersOf(after, 0, after.length);
      if (prefix === undefined || suffix === undefined) return 0;
      if (prefix.length + 1 + suffix.length > MAX_FORM_LENGTH) return 0;
      let mask = 0;
      for (let code = 0; code < LETTER_COUNT; code += 1) {
        if (formRefByString.has(prefix + String.fromCharCode(CODE_A + code) + suffix))
          mask |= 1 << code;
      }
      return mask;
    },
  };
  return Object.freeze(index);
}
