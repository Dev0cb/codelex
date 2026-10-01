#!/usr/bin/env node
// Lexicon validator: structural checks driven by schema/term.schema.json + graph invariants
// (docs/game/LEXICON_SPEC.md §5). Zero dependencies so hooks can run it before `pnpm install`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gameValue, knowledgeXp } from './formulas.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(PKG, 'schema/term.schema.json'), 'utf8'));
const TERM = schema.$defs.term;
const P = TERM.properties;
export const KINDS = new Set(P.kind.enum);
export const DIFFICULTIES = new Set(P.difficulty.enum);
export const RELATION_TYPES = new Set(P.relations.items.properties.type.enum);
const ID_RE = new RegExp(P.id.pattern);
const FORM_RE = new RegExp(P.form.pattern);
const MAX_DEF = P.definitions.properties.en.maxLength;
const MIN_DEF = P.definitions.properties.en.minLength;
const ALLOWED_KEYS = new Set(Object.keys(P));

/**
 * Validates a whole lexicon. Pure: takes parsed data, returns { errors, stats }.
 * @param {{categories: Array<{id:string}>, files: Array<{path:string, data:any}>, blocklist: Set<string>}} input
 */
export function validateLexicon({ categories, files, blocklist }) {
  const errors = [];
  const e = (where, msg) => errors.push(`${where}: ${msg}`);
  const categoryIds = new Set();
  for (const c of categories) {
    if (!c?.id || !/^[a-z][a-z0-9-]*$/.test(c.id)) e('categories.json', `invalid category id "${c?.id}"`);
    else if (categoryIds.has(c.id)) e('categories.json', `duplicate category "${c.id}"`);
    else categoryIds.add(c.id);
    if (!c?.name?.en || !c?.name?.fr) e('categories.json', `category "${c?.id}" needs name.en and name.fr`);
  }

  const terms = new Map();
  const forms = new Map();
  for (const { path, data } of files) {
    if (data?.schemaVersion !== 1) e(path, 'schemaVersion must be 1');
    if (!categoryIds.has(data?.category)) e(path, `file category "${data?.category}" is not registered`);
    if (!Array.isArray(data?.terms)) { e(path, 'terms must be an array'); continue; }
    for (const t of data.terms) {
      const w = `${path}#${t?.id ?? '?'}`;
      for (const k of Object.keys(t ?? {})) if (!ALLOWED_KEYS.has(k)) e(w, `unknown field "${k}"`);
      for (const k of TERM.required) if (t?.[k] === undefined) e(w, `missing required field "${k}"`);
      if (typeof t?.id !== 'string' || !ID_RE.test(t.id)) { e(w, 'invalid id'); continue; }
      if (terms.has(t.id)) e(w, `duplicate id (also in ${terms.get(t.id).path})`);
      terms.set(t.id, { ...t, path });

      if (t.playable) {
        if (typeof t.form !== 'string' || !FORM_RE.test(t.form)) e(w, `playable term needs form matching ${P.form.pattern}`);
        else {
          if (forms.has(t.form)) e(w, `duplicate playable form "${t.form}" (also ${forms.get(t.form)})`);
          forms.set(t.form, t.id);
          if (blocklist.has(t.form)) e(w, `form "${t.form}" is blocklisted`);
        }
      } else if (t.form !== undefined && !FORM_RE.test(t.form)) e(w, 'form must be A-Z 2..15 when present');

      if (!KINDS.has(t.kind)) e(w, `invalid kind "${t.kind}"`);
      if (t.kind === 'product' && !t.owner) e(w, 'product terms need an owner (trademark holder)');
      if (!DIFFICULTIES.has(t.difficulty)) e(w, `invalid difficulty "${t.difficulty}"`);
      if (!Array.isArray(t.categories) || t.categories.length === 0) e(w, 'needs at least one category');
      else {
        if (t.categories[0] !== data.category) e(w, `primary category "${t.categories[0]}" must equal file category "${data.category}"`);
        if (new Set(t.categories).size !== t.categories.length) e(w, 'duplicate categories');
        for (const c of t.categories) if (!categoryIds.has(c)) e(w, `unknown category "${c}"`);
      }
      for (const lang of ['en', 'fr']) {
        const d = t.definitions?.[lang];
        if (typeof d !== 'string' || d.length < MIN_DEF || d.length > MAX_DEF) e(w, `definitions.${lang} must be ${MIN_DEF}..${MAX_DEF} chars`);
      }
      for (const s of t.sources ?? []) if (!/^https:\/\//.test(s)) e(w, `source must be https: ${s}`);

      if (t.playable && FORM_RE.test(t.form ?? '') && DIFFICULTIES.has(t.difficulty)) {
        const gv = t.override?.gameValue ?? gameValue(t.form, t.difficulty);
        const xp = t.override?.knowledgeXp ?? knowledgeXp(t.form, t.difficulty);
        if (t.gameValue !== undefined && t.gameValue !== gv) e(w, `gameValue ${t.gameValue} != computed ${gv}`);
        if (t.knowledgeXp !== undefined && t.knowledgeXp !== xp) e(w, `knowledgeXp ${t.knowledgeXp} != computed ${xp}`);
      }
    }
  }

  // Graph invariants
  const isA = new Map();
  let edges = 0;
  for (const t of terms.values()) {
    const w = `${t.path}#${t.id}`;
    const seen = new Set();
    for (const r of t.relations ?? []) {
      edges++;
      if (!RELATION_TYPES.has(r?.type)) e(w, `invalid relation type "${r?.type}"`);
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
      if (next === undefined) { colour.set(top[0], 2); stack.pop(); continue; }
      const c = colour.get(next) ?? 0;
      if (c === 1) { e(`${terms.get(top[0])?.path}#${top[0]}`, `is_a cycle through "${next}"`); continue; }
      if (c === 0 && terms.has(next)) { colour.set(next, 1); stack.push([next, 0]); }
    }
  }

  const byDifficulty = Object.fromEntries([...DIFFICULTIES].map((d) => [d, 0]));
  const byCategory = {};
  for (const t of terms.values()) {
    if (byDifficulty[t.difficulty] !== undefined) byDifficulty[t.difficulty]++;
    const c = t.categories?.[0];
    if (c) byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  return { errors, stats: { terms: terms.size, playable: forms.size, edges, byDifficulty, byCategory } };
}

export function loadLexicon(dataDir = join(PKG, 'data')) {
  const categories = JSON.parse(readFileSync(join(dataDir, 'categories.json'), 'utf8')).categories ?? [];
  const termsDir = join(dataDir, 'terms');
  const files = readdirSync(termsDir).filter((f) => f.endsWith('.json')).sort().map((f) => ({
    path: relative(PKG, join(termsDir, f)),
    raw: readFileSync(join(termsDir, f), 'utf8'),
  })).map(({ path, raw }) => ({ path, raw, data: JSON.parse(raw) }));
  const blocklist = new Set();
  const blDir = join(dataDir, 'blocklist');
  if (existsSync(blDir)) {
    for (const f of readdirSync(blDir).filter((x) => x.endsWith('.txt'))) {
      for (const line of readFileSync(join(blDir, f), 'utf8').split('\n')) {
        const s = line.trim();
        if (s && !s.startsWith('#')) blocklist.add(s.toUpperCase());
      }
    }
  }
  const hash = createHash('sha256');
  for (const f of files) hash.update(f.path).update('\0').update(f.raw);
  return { categories, files, blocklist, version: hash.digest('hex').slice(0, 16) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let lex;
  try { lex = loadLexicon(); } catch (err) { console.error(`Lexicon load FAILED: ${err.message}`); process.exit(1); }
  const { errors, stats } = validateLexicon(lex);
  if (errors.length) {
    console.error(`Lexicon validation FAILED (${errors.length}):`);
    for (const x of errors) console.error(`  ✗ ${x}`);
    process.exit(1);
  }
  console.log(`Lexicon OK — version ${lex.version}: ${stats.terms} terms (${stats.playable} playable), ${stats.edges} relations`);
  console.log(`  by difficulty: ${JSON.stringify(stats.byDifficulty)}`);
  console.log(`  by category:   ${JSON.stringify(stats.byCategory)}`);
}
