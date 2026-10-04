// Seeded scale corpora for the size gate (lexicon-index note §5, task T8 "scale fixtures", sprint 3 task P7).
// Clearly synthetic: they validate scaling trends of the `.clxi` artefact, not real sharing ratios.
//
// Model fitted on the real lexicon (canonical document D, playable terms):
//   - canonical form lengths: empirical distribution;
//   - letters: first-order Markov chain (start letter + letter bigrams) over the real canonical forms;
//   - inflections: per synthetic term, a plural (+S) and a verb pair (+ED, +ING) at the real rates;
//   - relations per term (related_to) at the real mean, difficulties and primary categories at the real mix.
// Two corpora:
//   - `synthetic`: only generated terms, exactly `forms` playable forms;
//   - `real+synthetic`: every real term (playable or not) plus generated terms up to exactly `forms` playable forms.
// Pure and deterministic: same (lexicon, kind, forms, seed) ⇒ same terms. Zero dependencies (like validate.mjs).
import { gameValue, knowledgeXp } from './formulas.mjs';

const A = 65;
const FORM_RE = /^[A-Z]{2,15}$/;
export const SCALE_CORPUS_KINDS = Object.freeze(['synthetic', 'real+synthetic']);

/** mulberry32: small seeded PRNG (32-bit state), uniform floats in [0, 1). Not for anything security-related. */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index drawn from non-negative integer weights (deterministic for a given `random`). */
function pick(weights, random) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(random() * weights.length);
  let draw = random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    draw -= weights[i];
    if (draw < 0) return i;
  }
  return weights.length - 1;
}

const playableTerms = (terms) =>
  terms.filter((t) => t.playable === true && typeof t.form === 'string' && FORM_RE.test(t.form));

/**
 * Fits the generation model on canonical document terms (`lexiconContentDocument(lex).terms`).
 * @param {readonly import('./canonical.d.mts').CanonicalTerm[]} terms
 */
export function fitFormModel(terms) {
  const playable = playableTerms(terms);
  if (playable.length === 0) throw new RangeError('fitFormModel: no playable term');
  const lengths = Array.from({ length: 16 }, () => 0);
  const starts = Array.from({ length: 26 }, () => 0);
  const bigrams = Array.from({ length: 26 }, () => Array.from({ length: 26 }, () => 0));
  const difficulties = new Map();
  const categories = new Map();
  let plurals = 0;
  let verbs = 0;
  let relations = 0;
  let eligible = 0;
  for (const t of playable) {
    const form = t.form;
    lengths[form.length] += 1;
    starts[form.charCodeAt(0) - A] += 1;
    for (let i = 1; i < form.length; i += 1)
      bigrams[form.charCodeAt(i - 1) - A][form.charCodeAt(i) - A] += 1;
    difficulties.set(t.difficulty, (difficulties.get(t.difficulty) ?? 0) + 1);
    const primary = t.categories[0];
    categories.set(primary, (categories.get(primary) ?? 0) + 1);
    relations += t.relations.length;
    if (form.length >= 3) eligible += 1;
    for (const i of t.inflections) {
      if (i.kind === 'plural') plurals += 1;
      else if (i.kind === 'verb_ed') verbs += 1;
    }
  }
  return Object.freeze({
    lengths,
    starts,
    bigrams,
    difficulties: [...difficulties.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    categories: [...categories.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    pluralRate: eligible === 0 ? 0 : plurals / eligible,
    verbRate: eligible === 0 ? 0 : verbs / eligible,
    relationsPerTerm: relations / playable.length,
  });
}

function sampleForm(model, random) {
  const length = pick(model.lengths, random);
  let code = pick(model.starts, random);
  let form = String.fromCharCode(A + code);
  while (form.length < length) {
    const row = model.bigrams[code];
    code = pick(row, random);
    form += String.fromCharCode(A + code);
  }
  return form;
}

/**
 * Generated terms adding exactly `forms` playable forms that collide with nothing in `taken` (mutated: every new
 * form is added). Relation targets are drawn from `targets` (ids of existing terms) and earlier generated terms.
 * @param {{ model: ReturnType<typeof fitFormModel>, forms: number, seed: number,
 *           taken: Set<string>, targets?: readonly string[], idPrefix?: string }} options
 */
export function generateTerms({ model, forms, seed, taken, targets = [], idPrefix = 'syn-' }) {
  if (!Number.isInteger(forms) || forms < 0)
    throw new RangeError('generateTerms: forms must be >= 0');
  const random = seededRandom(seed);
  const ids = [...targets];
  const out = [];
  let added = 0;
  let attempts = 0;
  while (added < forms) {
    attempts += 1;
    if (attempts > forms * 1000 + 10_000) throw new RangeError('generateTerms: model too narrow');
    const form = sampleForm(model, random);
    if (!FORM_RE.test(form) || taken.has(form)) continue;
    const inflections = [];
    const room = () => forms - added - 1 - inflections.length;
    const tryAdd = (f, kind) => {
      if (room() > 0 && FORM_RE.test(f) && !taken.has(f) && f !== form)
        inflections.push({ form: f, kind });
    };
    if (form.length >= 3 && random() < model.pluralRate && !form.endsWith('S'))
      tryAdd(`${form}S`, 'plural');
    if (form.length >= 3 && random() < model.verbRate) {
      tryAdd(`${form}ED`, 'verb_ed');
      tryAdd(`${form}ING`, 'verb_ing');
    }
    inflections.sort((a, b) => (a.form < b.form ? -1 : a.form > b.form ? 1 : 0));
    const difficulty =
      model.difficulties[
        pick(
          model.difficulties.map(([, n]) => n),
          random,
        )
      ][0];
    const primary =
      model.categories[
        pick(
          model.categories.map(([, n]) => n),
          random,
        )
      ][0];
    const id = `${idPrefix}${String(out.length)}`;
    // Relation count: floor(mean) plus one more with the fractional probability, distinct targets.
    const want =
      Math.floor(model.relationsPerTerm) + (random() < model.relationsPerTerm % 1 ? 1 : 0);
    const relationTargets = new Set();
    for (let r = 0; r < want * 4 && relationTargets.size < want && ids.length > 0; r += 1)
      relationTargets.add(ids[Math.floor(random() * ids.length)]);
    taken.add(form);
    for (const i of inflections) taken.add(i.form);
    added += 1 + inflections.length;
    ids.push(id);
    out.push({
      id,
      playable: true,
      kind: 'concept',
      form,
      difficulty,
      categories: [primary],
      inflections,
      relations: [...relationTargets].sort().map((target) => ({ type: 'related_to', target })),
      tags: [],
      gameValue: gameValue(form, difficulty),
      knowledgeXp: knowledgeXp(form, difficulty),
    });
  }
  return out;
}

const formsOf = (terms) => playableTerms(terms).reduce((n, t) => n + 1 + t.inflections.length, 0);

/**
 * Terms of a scale corpus with exactly `forms` playable forms.
 * @param {{ terms: readonly import('./canonical.d.mts').CanonicalTerm[], blocklist?: Iterable<string>,
 *           kind: 'synthetic' | 'real+synthetic', forms: number, seed?: number }} options
 */
export function scaleCorpus({ terms, blocklist = [], kind, forms, seed = 1 }) {
  if (!SCALE_CORPUS_KINDS.includes(kind)) throw new RangeError(`scaleCorpus: unknown kind ${kind}`);
  const model = fitFormModel(terms);
  const taken = new Set(blocklist);
  if (kind === 'synthetic') return generateTerms({ model, forms, seed, taken });
  const real = playableTerms(terms);
  const have = formsOf(real);
  if (forms < have) throw new RangeError(`scaleCorpus: real lexicon already has ${have} forms`);
  for (const t of real) {
    taken.add(t.form);
    for (const i of t.inflections) taken.add(i.form);
  }
  const extra = generateTerms({
    model,
    forms: forms - have,
    seed,
    taken,
    targets: real.map((t) => t.id),
  });
  return [...terms, ...extra];
}
