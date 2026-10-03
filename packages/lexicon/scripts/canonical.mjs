// Canonical JSON (RFC 8785 / JCS) and content versions of the lexicon (ADR-0013 §D7, LEXICON_SPEC §7).
// Build-time only: uses node:crypto (the engine ships its own pure-TS SHA-256 and JCS subset).
// Zero dependencies so hooks can run it before `pnpm install`.
import { createHash } from 'node:crypto';
import { gameValue, knowledgeXp } from './formulas.mjs';

/** Version of the canonical document definitions below. Bump when a field is added/removed (changes every version). */
export const CONTENT_FORMAT = 1;

const FORM_RE = /^[A-Z]{2,15}$/;
const DIFFICULTIES = new Set(['novice', 'intermediate', 'advanced', 'expert']);

/** Explicit UTF-16 code-unit comparator (never locale-dependent). */
export const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * RFC 8785 canonical JSON. Strings and numbers use the ECMAScript JSON serialisation (as RFC 8785 §3.2.2 requires);
 * object keys are sorted by UTF-16 code units. Throws TypeError on anything that is not plain JSON.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`JCS: non-finite number ${value}`);
      return JSON.stringify(value); // -0 -> "0", shortest round-trip form per ECMA-262 Number::toString
    case 'string':
      if (!value.isWellFormed()) throw new TypeError('JCS: lone surrogate in string');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = [];
        for (let i = 0; i < value.length; i++) {
          if (!Object.hasOwn(value, i))
            throw new TypeError(`JCS: sparse array (hole at index ${i})`);
          items.push(canonicalize(value[i]));
        }
        return `[${items.join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null)
        throw new TypeError('JCS: only plain objects are allowed');
      const keys = Object.keys(value).sort(byCodeUnit);
      for (const k of keys)
        if (!k.isWellFormed()) throw new TypeError('JCS: lone surrogate in object key');
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`JCS: unsupported value of type ${typeof value}`);
  }
}

/** First 16 lowercase hex chars of SHA-256 over the UTF-8 bytes of `text`. */
export function sha256Hex16(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

const allTerms = (lex) =>
  lex.files.flatMap((f) => (Array.isArray(f.data?.terms) ? f.data.terms : []));
const sortedUnique = (xs) => [...new Set(xs)].sort(byCodeUnit);
const sortById = (a, b) => byCodeUnit(a.id, b.id);

/**
 * Canonical document D of the playable lexicon content (ADR-0013 §D7). Field list is normative and mirrored in
 * docs/game/LEXICON_SPEC.md §7. Independent of file layout, key order, whitespace, line endings and the order of
 * arrays without semantic order. Assumes data that passes `validateLexicon` (callers only publish valid data); it
 * never throws on invalid data so the validator can still report errors.
 */
export function lexiconContentDocument(lex) {
  const terms = allTerms(lex).map((t) => {
    const cats = Array.isArray(t.categories) ? t.categories : [];
    const d = {
      id: t.id,
      playable: t.playable === true,
      kind: t.kind,
      difficulty: t.difficulty,
      // First category is the primary one (semantic); secondary categories are a set.
      categories: cats.length ? [cats[0], ...[...cats.slice(1)].sort(byCodeUnit)] : [],
      inflections: (Array.isArray(t.inflections) ? t.inflections : [])
        .map((i) => ({ form: i?.form, kind: i?.kind }))
        .sort((a, b) => byCodeUnit(a.form, b.form) || byCodeUnit(a.kind, b.kind)),
      relations: (Array.isArray(t.relations) ? t.relations : [])
        .map((r) => ({ type: r?.type, target: r?.target }))
        .sort((a, b) => byCodeUnit(a.type, b.type) || byCodeUnit(a.target, b.target)),
      tags: sortedUnique(Array.isArray(t.tags) ? t.tags : []),
    };
    if (t.form !== undefined) d.form = t.form;
    if (
      d.playable &&
      typeof t.form === 'string' &&
      FORM_RE.test(t.form) &&
      DIFFICULTIES.has(t.difficulty)
    ) {
      // Effective values the index encodes: an approved override wins over the formula.
      d.gameValue = t.override?.gameValue ?? gameValue(t.form, t.difficulty);
      d.knowledgeXp = t.override?.knowledgeXp ?? knowledgeXp(t.form, t.difficulty);
    }
    return stripUndefined(d);
  });
  return {
    contentFormat: CONTENT_FORMAT,
    categories: sortedUnique(lex.categories.map((c) => c?.id).filter((x) => x !== undefined)),
    blocklist: sortedUnique([...lex.blocklist]),
    terms: terms.sort(sortById),
  };
}

/**
 * Canonical document of the display-only content (Knowledge Cards artefact, lexicon-index note §3.6): everything
 * excluded from lexiconVersion. A definition fix changes cardsVersion, never lexiconVersion.
 */
export function cardsContentDocument(lex) {
  const terms = allTerms(lex).map((t) =>
    stripUndefined({
      id: t.id,
      display: t.display,
      definitions: t.definitions,
      owner: t.owner,
      aliases: sortedUnique(Array.isArray(t.aliases) ? t.aliases : []),
      sources: sortedUnique(Array.isArray(t.sources) ? t.sources : []),
    }),
  );
  return {
    contentFormat: CONTENT_FORMAT,
    categories: lex.categories.map((c) => stripUndefined({ ...c })).sort(sortById),
    terms: terms.sort(sortById),
  };
}

/** lexiconVersion = hex(SHA-256(UTF-8(JCS(D))))[0..16) — ADR-0013 §D7. */
export function computeLexiconVersion(lex) {
  return sha256Hex16(canonicalize(lexiconContentDocument(lex)));
}

/** cardsVersion = same construction over the display-only document. */
export function computeCardsVersion(lex) {
  return sha256Hex16(canonicalize(cardsContentDocument(lex)));
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v);
    return out;
  }
  return value;
}

/**
 * The global ranked profile: every playable term (lexicon-index note §4.2). Season and org profiles will be
 * `data/profiles/<id>.json` files with the same shape.
 */
export const GLOBAL_PROFILE = Object.freeze({
  id: 'global-ranked',
  kind: 'global',
  include: Object.freeze({ all: true }),
});

/** definitionHash = sha256 (first 16 hex) of the canonical profile definition (lexicon-index note §4.2). */
export function profileDefinitionHash(definition) {
  return sha256Hex16(canonicalize(definition));
}
