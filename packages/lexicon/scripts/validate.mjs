#!/usr/bin/env node
// Lexicon validator: structural checks driven by schema/term.schema.json + graph invariants + the playable-form
// namespace (docs/game/LEXICON_SPEC.md §5). Zero dependencies so hooks can run it before `pnpm install`.
// Usage: node scripts/validate.mjs [--report <path.json>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gameValue, knowledgeXp } from './formulas.mjs';
import { byCodeUnit, computeCardsVersion, computeLexiconVersion } from './canonical.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(PKG, 'schema/term.schema.json'), 'utf8'));
const TERM = schema.$defs.term;
const P = TERM.properties;
export const SCHEMA_VERSION = schema.properties.schemaVersion.const;
export const KINDS = new Set(P.kind.enum);
export const DIFFICULTIES = new Set(P.difficulty.enum);
export const RELATION_TYPES = new Set(P.relations.items.properties.type.enum);
export const INFLECTION_KINDS = new Set(P.inflections.items.properties.kind.enum);
export const MAX_INFLECTIONS = P.inflections.maxItems;
/** Term kinds that never take inflections (spec E-1.7 D-6: trademarks are not pluralised; JAVAS). */
export const NO_INFLECTION_KINDS = new Set(['product', 'language']);
/** Term kinds that need ≥ 1 source (D-11): NEEDS_REVIEW warning in schema v2. */
export const SOURCED_KINDS = new Set(['product', 'protocol', 'standard']);
/** Expected suffix per inflection kind; a mismatch is a NEEDS_REVIEW warning, never an error (AC-6). */
const KIND_SUFFIX = { plural: 'S', verb_s: 'S', verb_ed: 'ED', verb_ing: 'ING' };
const ID_RE = new RegExp(P.id.pattern);
const FORM_RE = new RegExp(P.form.pattern);
const INFLECTION_FORM_RE = new RegExp(P.inflections.items.properties.form.pattern);
const INFLECTION_KEYS = new Set(Object.keys(P.inflections.items.properties));
const MAX_DEF = P.definitions.properties.en.maxLength;
const MIN_DEF = P.definitions.properties.en.minLength;
const ALLOWED_KEYS = new Set(Object.keys(P));
const LENGTH_BUCKETS = [
  ['2', 2, 2],
  ['3', 3, 3],
  ['4', 4, 4],
  ['5-7', 5, 7],
  ['8-10', 8, 10],
  ['11-15', 11, 15],
];

/** Term fields checked generically against their schema declaration (the others have dedicated rules above). */
const SHAPE_CHECKED_FIELDS = [
  'playable',
  'override',
  'gameValue',
  'knowledgeXp',
  'tags',
  'aliases',
  'relations',
  'sources',
];

/** Blocklist entries are compared with A-Z forms: strip diacritics (NFD + remove marks) and uppercase. */
export const foldBlocklistEntry = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const TYPE_CHECKS = {
  boolean: (v) => typeof v === 'boolean',
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  array: Array.isArray,
  object: isPlainObject,
};

/**
 * Minimal JSON Schema subset used by term.schema.json (type, enum, const, pattern, min/maxLength, minimum,
 * min/maxItems, uniqueItems, items, required, properties, additionalProperties: false). Zero dependencies on
 * purpose: CI and hooks run the validator before `pnpm install`.
 */
function checkShape(s, v, path, err) {
  if (s.enum && !s.enum.includes(v)) {
    err(`field "${path}" must be one of ${s.enum.join(' | ')}`);
    return;
  }
  if (s.const !== undefined && v !== s.const) {
    err(`field "${path}" must be ${JSON.stringify(s.const)}`);
    return;
  }
  if (s.type && !TYPE_CHECKS[s.type](v)) {
    err(
      `field "${path}" must be ${s.type === 'integer' ? 'an integer' : `${s.type === 'array' || s.type === 'object' ? 'an' : 'a'} ${s.type}`}`,
    );
    return;
  }
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v))
      err(`field "${path}" must match ${s.pattern}`);
    if (s.minLength !== undefined && v.length < s.minLength)
      err(`field "${path}" must have >= ${s.minLength} chars`);
    if (s.maxLength !== undefined && v.length > s.maxLength)
      err(`field "${path}" must have <= ${s.maxLength} chars`);
  }
  if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum)
    err(`field "${path}" must be >= ${s.minimum}`);
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems)
      err(`field "${path}" needs >= ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems)
      err(`field "${path}" allows <= ${s.maxItems} items`);
    if (s.uniqueItems) {
      const keys = v.map((x) => JSON.stringify(x));
      if (new Set(keys).size !== keys.length) err(`field "${path}" items must be unique`);
    }
    if (s.items) v.forEach((x, i) => checkShape(s.items, x, `${path}[${i}]`, err));
  }
  if (isPlainObject(v)) {
    for (const k of s.required ?? [])
      if (v[k] === undefined) err(`field "${path}" missing required "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      const sub = s.properties?.[k];
      if (sub) {
        if (x !== undefined) checkShape(sub, x, `${path}.${k}`, err);
      } else if (s.additionalProperties === false) err(`field "${path}.${k}" is not allowed`);
    }
  }
}

const lengthBucket = (n) => LENGTH_BUCKETS.find(([, lo, hi]) => n >= lo && n <= hi)?.[0];

/**
 * Validates a whole lexicon. Pure: takes parsed data, returns { errors, warnings, stats }.
 * Errors fail the build; warnings are `NEEDS_REVIEW` items the curator confirms (non-blocking).
 * @param {{categories: Array<{id:string}>, files: Array<{path:string, data:any}>, blocklist: Set<string>}} input
 */
export function validateLexicon({ categories, files, blocklist }) {
  const errors = [];
  const warnings = [];
  const e = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`NEEDS_REVIEW ${where}: ${msg}`);
  const categoryIds = new Set();
  for (const c of categories) {
    if (!c?.id || !/^[a-z][a-z0-9-]*$/.test(c.id))
      e('categories.json', `invalid category id "${c?.id}"`);
    else if (categoryIds.has(c.id)) e('categories.json', `duplicate category "${c.id}"`);
    else categoryIds.add(c.id);
    if (!c?.name?.en || !c?.name?.fr)
      e('categories.json', `category "${c?.id}" needs name.en and name.fr`);
  }

  const terms = new Map();
  /** One global namespace of playable strings: form -> { termId, where, kind: 'canonical' | inflection kind }. */
  const forms = new Map();
  const pendingInflections = [];
  for (const { path, data } of files) {
    if (data?.schemaVersion !== SCHEMA_VERSION) {
      e(
        path,
        `schemaVersion must be ${SCHEMA_VERSION} (found ${JSON.stringify(data?.schemaVersion)}; run scripts/migrate-v1-to-v2.mjs)`,
      );
    }
    if (!categoryIds.has(data?.category))
      e(path, `file category "${data?.category}" is not registered`);
    if (!Array.isArray(data?.terms)) {
      e(path, 'terms must be an array');
      continue;
    }
    for (const t of data.terms) {
      const w = `${path}#${t?.id ?? '?'}`;
      for (const k of Object.keys(t ?? {})) if (!ALLOWED_KEYS.has(k)) e(w, `unknown field "${k}"`);
      for (const k of TERM.required)
        if (t?.[k] === undefined) e(w, `missing required field "${k}"`);
      if (typeof t?.id !== 'string' || !ID_RE.test(t.id)) {
        e(w, 'invalid id');
        continue;
      }
      if (terms.has(t.id)) e(w, `duplicate id (also in ${terms.get(t.id).path})`);
      terms.set(t.id, { ...t, path });

      if (t.playable === true) {
        if (typeof t.form !== 'string' || !FORM_RE.test(t.form))
          e(w, `playable term needs form matching ${P.form.pattern}`);
        else {
          const prev = forms.get(t.form);
          if (prev)
            e(
              w,
              `duplicate playable form "${t.form}" (also term "${prev.termId}" in ${prev.where})`,
            );
          else forms.set(t.form, { termId: t.id, where: w, kind: 'canonical' });
          if (blocklist.has(t.form)) e(w, `form "${t.form}" is blocklisted`);
        }
      } else if (t.form !== undefined && !FORM_RE.test(t.form))
        e(w, 'form must be A-Z 2..15 when present');

      if (!KINDS.has(t.kind)) e(w, `invalid kind "${t.kind}"`);
      if (t.kind === 'product' && !t.owner) e(w, 'product terms need an owner (trademark holder)');
      if (SOURCED_KINDS.has(t.kind) && !(Array.isArray(t.sources) && t.sources.length > 0)) {
        warn(w, `${t.kind} term has no sources (D-11: ≥ 1 official URL)`);
      }
      if (!DIFFICULTIES.has(t.difficulty)) e(w, `invalid difficulty "${t.difficulty}"`);
      if (!Array.isArray(t.categories) || t.categories.length === 0)
        e(w, 'needs at least one category');
      else {
        if (t.categories[0] !== data.category)
          e(w, `primary category "${t.categories[0]}" must equal file category "${data.category}"`);
        if (new Set(t.categories).size !== t.categories.length) e(w, 'duplicate categories');
        for (const c of t.categories) if (!categoryIds.has(c)) e(w, `unknown category "${c}"`);
      }
      for (const lang of ['en', 'fr']) {
        const d = t.definitions?.[lang];
        if (typeof d !== 'string' || d.length < MIN_DEF || d.length > MAX_DEF)
          e(w, `definitions.${lang} must be ${MIN_DEF}..${MAX_DEF} chars`);
      }
      // Schema types of every remaining hashed/exported field (canonical.mjs assumes validated data).
      for (const k of SHAPE_CHECKED_FIELDS)
        if (t[k] !== undefined) checkShape(P[k], t[k], k, (msg) => e(w, msg));

      if (t.playable === true && FORM_RE.test(t.form ?? '') && DIFFICULTIES.has(t.difficulty)) {
        const gv = t.override?.gameValue ?? gameValue(t.form, t.difficulty);
        const xp = t.override?.knowledgeXp ?? knowledgeXp(t.form, t.difficulty);
        if (t.gameValue !== undefined && t.gameValue !== gv)
          e(w, `gameValue ${t.gameValue} != computed ${gv}`);
        if (t.knowledgeXp !== undefined && t.knowledgeXp !== xp)
          e(w, `knowledgeXp ${t.knowledgeXp} != computed ${xp}`);
      }

      if (t.inflections !== undefined)
        pendingInflections.push(...checkInflections(t, w, e, warn, blocklist));
    }
  }

  // Inflections join the namespace after every canonical form is known, so the result does not depend on file
  // order: a standalone term always owns its string (D-5) and the inflection is the one reported.
  for (const i of pendingInflections) {
    const prev = forms.get(i.form);
    if (prev?.kind === 'canonical') {
      e(
        i.where,
        `inflection "${i.form}" collides with the form of term "${prev.termId}" (${prev.where}); the standalone term owns the string (D-5): remove it from "${i.termId}"`,
      );
    } else if (prev) {
      e(
        i.where,
        `inflection "${i.form}" is also declared by term "${prev.termId}" (${prev.where}); a form resolves to one term only (D-5)`,
      );
    } else forms.set(i.form, { termId: i.termId, where: i.where, kind: i.kind });
  }

  // Graph invariants
  const isA = new Map();
  let edges = 0;
  for (const t of terms.values()) {
    const w = `${t.path}#${t.id}`;
    const seen = new Set();
    for (const r of Array.isArray(t.relations) ? t.relations : []) {
      if (!isPlainObject(r)) continue; // shape error already reported
      edges++;
      if (r?.target === t.id) e(w, 'self relation');
      else if (!terms.has(r?.target)) e(w, `dangling relation target "${r?.target}"`);
      const key = `${r?.type}>${r?.target}`;
      if (seen.has(key)) e(w, `duplicate relation ${key}`);
      seen.add(key);
      if (r?.type === 'is_a') isA.set(t.id, [...(isA.get(t.id) ?? []), r.target]);
    }
  }
  // Cycle detection on is_a (iterative DFS with colours).
  const colour = new Map();
  for (const start of isA.keys()) {
    if (colour.get(start)) continue;
    const stack = [[start, 0]];
    colour.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (isA.get(top[0]) ?? [])[top[1]++];
      if (next === undefined) {
        colour.set(top[0], 2);
        stack.pop();
        continue;
      }
      const c = colour.get(next) ?? 0;
      if (c === 1) {
        e(`${terms.get(top[0])?.path}#${top[0]}`, `is_a cycle through "${next}"`);
        continue;
      }
      if (c === 0 && terms.has(next)) {
        colour.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }

  return { errors, warnings, stats: computeStats(terms, forms, categoryIds, edges) };
}

/** Shape rules of one term's `inflections` (AC-4, AC-5, AC-6, AC-15). Returns the entries eligible for the namespace. */
function checkInflections(t, w, e, warn, blocklist) {
  if (!Array.isArray(t.inflections)) {
    e(w, 'inflections must be an array');
    return [];
  }
  const list = t.inflections;
  if (list.length === 0) return [];
  // An invalid owner contributes nothing to the namespace or stats: report and stop.
  if (t.playable !== true || typeof t.form !== 'string') {
    e(w, 'inflections require a playable term with a form');
    return [];
  }
  if (NO_INFLECTION_KINDS.has(t.kind)) {
    e(w, `no inflections on ${t.kind} terms (D-6)`);
    return [];
  }
  if (list.length > MAX_INFLECTIONS)
    e(w, `has ${list.length} inflections; at most ${MAX_INFLECTIONS} allowed`);
  const out = [];
  const seen = new Set();
  let prevForm;
  for (const i of list) {
    for (const k of Object.keys(i ?? {}))
      if (!INFLECTION_KEYS.has(k)) e(w, `unknown inflection field "${k}"`);
    const form = i?.form;
    if (!INFLECTION_KINDS.has(i?.kind))
      e(
        w,
        `inflection "${form}" has invalid inflection kind "${i?.kind}" (${[...INFLECTION_KINDS].join(' | ')})`,
      );
    if (typeof form !== 'string' || !INFLECTION_FORM_RE.test(form)) {
      e(w, `inflection form "${form}" must match ${INFLECTION_FORM_RE.source}`);
      continue;
    }
    if (prevForm !== undefined && byCodeUnit(prevForm, form) > 0)
      e(w, `inflections must be sorted by form ("${prevForm}" before "${form}")`);
    prevForm = form;
    if (seen.has(form)) {
      e(w, `duplicate inflection "${form}"`);
      continue;
    }
    seen.add(form);
    if (form === t.form) {
      e(w, `inflection "${form}" equals the term form`);
      continue;
    }
    if (form.length === 2)
      e(w, `inflection "${form}" is two-letter; two-letter forms must be canonical terms (AC-15)`);
    if (blocklist.has(form)) e(w, `inflection "${form}" is blocklisted`);
    if (typeof t.form === 'string' && !form.startsWith(t.form))
      warn(w, `inflection "${form}" does not start with "${t.form}" (irregular form: confirm)`);
    const suffix = KIND_SUFFIX[i.kind];
    if (suffix && !form.endsWith(suffix))
      warn(w, `${i.kind} "${form}" does not end in ${suffix} (irregular form: confirm)`);
    out.push({ form, kind: i.kind, termId: t.id, where: w });
  }
  return out;
}

function computeStats(terms, forms, categoryIds, edges) {
  const byLength = Object.fromEntries(LENGTH_BUCKETS.map(([k]) => [k, 0]));
  const byInflectionKind = Object.fromEntries([...INFLECTION_KINDS].map((k) => [k, 0]));
  const byDifficulty = Object.fromEntries([...DIFFICULTIES].map((d) => [d, 0]));
  const byPrimaryCategory = Object.fromEntries([...categoryIds].map((c) => [c, 0]));
  const byCategory = {};
  let canonical = 0;
  for (const [form, f] of forms) {
    const b = lengthBucket(form.length);
    if (b) byLength[b]++;
    if (f.kind === 'canonical') {
      canonical++;
      const t = terms.get(f.termId);
      if (byDifficulty[t.difficulty] !== undefined) byDifficulty[t.difficulty]++;
      const c = t.categories?.[0];
      if (byPrimaryCategory[c] !== undefined) byPrimaryCategory[c]++;
    } else if (byInflectionKind[f.kind] !== undefined) byInflectionKind[f.kind]++;
  }
  for (const t of terms.values()) {
    const c = t.categories?.[0];
    if (c) byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  return {
    terms: terms.size,
    edges,
    forms: { canonical, inflections: forms.size - canonical, total: forms.size },
    byLength,
    byPrimaryCategory,
    byDifficulty,
    byInflectionKind,
    byCategory,
    twoLetterForms: [...forms.keys()].filter((f) => f.length === 2).sort(byCodeUnit),
  };
}

/**
 * Every playable string with the canonical term it resolves to, sorted by form (code-unit order).
 * Reads data as-is (no validation); used by the migration check and as the reference for index tests.
 * @returns {Array<{form: string, termId: string, kind: string}>}
 */
export function playableForms({ files }) {
  const out = [];
  for (const { data } of files) {
    for (const t of Array.isArray(data?.terms) ? data.terms : []) {
      if (t?.playable !== true || typeof t.form !== 'string') continue;
      out.push({ form: t.form, termId: t.id, kind: 'canonical' });
      for (const i of Array.isArray(t.inflections) ? t.inflections : [])
        out.push({ form: i.form, termId: t.id, kind: i.kind });
    }
  }
  return out.sort((a, b) => byCodeUnit(a.form, b.form) || byCodeUnit(a.termId, b.termId));
}

/** Batch-gate report (spec E-1.7 AC-7): validation result, versions and distribution counts. */
export function buildReport(lex) {
  const { errors, warnings, stats } = validateLexicon(lex);
  return {
    lexiconVersion: lex.version ?? computeLexiconVersion(lex),
    cardsVersion: lex.cardsVersion ?? computeCardsVersion(lex),
    schemaVersion: SCHEMA_VERSION,
    valid: errors.length === 0,
    errors,
    warnings,
    terms: stats.terms,
    relations: stats.edges,
    forms: stats.forms,
    byLength: stats.byLength,
    byPrimaryCategory: stats.byPrimaryCategory,
    byDifficulty: stats.byDifficulty,
    byInflectionKind: stats.byInflectionKind,
    twoLetterForms: stats.twoLetterForms,
  };
}

export function loadLexicon(dataDir = join(PKG, 'data')) {
  const categories =
    JSON.parse(readFileSync(join(dataDir, 'categories.json'), 'utf8')).categories ?? [];
  const termsDir = join(dataDir, 'terms');
  const files = readdirSync(termsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      path: relative(PKG, join(termsDir, f)).replaceAll('\\', '/'),
      data: JSON.parse(readFileSync(join(termsDir, f), 'utf8')),
    }));
  const blocklist = new Set();
  const blDir = join(dataDir, 'blocklist');
  const badLines = [];
  if (existsSync(blDir)) {
    for (const f of readdirSync(blDir)
      .filter((x) => x.endsWith('.txt'))
      .sort()) {
      readFileSync(join(blDir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const s = line.trim();
          if (!s || s.startsWith('#')) return;
          const folded = foldBlocklistEntry(s);
          if (FORM_RE.test(folded)) blocklist.add(folded);
          else badLines.push(`blocklist/${f}:${i + 1} ${JSON.stringify(s)}`);
        });
    }
  }
  if (badLines.length) {
    throw new Error(
      `blocklist entries must match ${P.form.pattern} after folding diacritics: ${badLines.join(', ')}`,
    );
  }
  const lex = { categories, files, blocklist };
  // Canonical content versions (ADR-0013 §D7): independent of paths, layout, whitespace and line endings.
  return { ...lex, version: computeLexiconVersion(lex), cardsVersion: computeCardsVersion(lex) };
}

function parseArgs(argv) {
  const i = argv.indexOf('--report');
  if (i === -1) return {};
  const path = argv[i + 1];
  if (!path || path.startsWith('--')) throw new Error('--report needs a file path');
  return { report: path };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let lex;
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    lex = loadLexicon();
  } catch (err) {
    console.error(`Lexicon load FAILED: ${err.message}`);
    process.exit(1);
  }
  const report = buildReport(lex);
  if (args.report) writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  if (report.warnings.length) {
    console.log(`NEEDS_REVIEW (${report.warnings.length}, non-blocking):`);
    for (const x of report.warnings) console.log(`  ! ${x.replace(/^NEEDS_REVIEW /, '')}`);
  }
  if (!report.valid) {
    console.error(`Lexicon validation FAILED (${report.errors.length}):`);
    for (const x of report.errors) console.error(`  ✗ ${x}`);
    process.exit(1);
  }
  const f = report.forms;
  console.log(
    `Lexicon OK — lexiconVersion ${report.lexiconVersion} (cards ${report.cardsVersion}), schema v${report.schemaVersion}`,
  );
  console.log(
    `  ${report.terms} terms, ${report.relations} relations; playable forms ${f.total} = ${f.canonical} canonical + ${f.inflections} inflections`,
  );
  console.log(`  by length:            ${JSON.stringify(report.byLength)}`);
  console.log(
    `  by primary category:  ${JSON.stringify(report.byPrimaryCategory)}  (canonical playable terms)`,
  );
  console.log(
    `  by difficulty:        ${JSON.stringify(report.byDifficulty)}  (canonical playable terms)`,
  );
  console.log(`  by inflection kind:   ${JSON.stringify(report.byInflectionKind)}`);
  console.log(
    `  two-letter forms (${report.twoLetterForms.length}): ${report.twoLetterForms.join(' ')}`,
  );
  if (args.report) console.log(`  report written to ${args.report}`);
}
