import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, loadLexicon, playableForms, validateLexicon } from '../scripts/validate.mjs';

const categories = [
  { id: 'devops', name: { en: 'DevOps', fr: 'DevOps' } },
  { id: 'cloud', name: { en: 'Cloud', fr: 'Cloud' } },
];
const term = (over = {}) => ({
  id: 'docker', form: 'DOCKER', display: 'Docker', playable: true, kind: 'tool', owner: 'Docker, Inc.',
  categories: ['devops'], difficulty: 'intermediate',
  definitions: { en: 'Platform to run apps in containers.', fr: 'Plateforme pour exécuter des applis en conteneurs.' },
  ...over,
});
const pod = (over = {}) => term({
  id: 'pod', form: 'POD', display: 'Pod', kind: 'concept', owner: undefined,
  inflections: [{ form: 'PODS', kind: 'plural' }], ...over,
});
const file = (terms, over = {}) => ({ path: 'terms/devops.json', data: { schemaVersion: 2, category: 'devops', terms, ...over } });
const run = (terms, blocklist = new Set()) => validateLexicon({ categories, blocklist, files: [file(terms)] });
const runFiles = (files, blocklist = new Set()) => validateLexicon({ categories, blocklist, files });
const has = (list, ...parts) => list.some((x) => parts.every((p) => x.includes(p)));

// ---------- seed ----------

test('the committed seed lexicon is valid and fully migrated to schema v2', () => {
  const lex = loadLexicon();
  const { errors, stats } = validateLexicon(lex);
  assert.deepEqual(errors, []);
  for (const f of lex.files) assert.equal(f.data.schemaVersion, 2, f.path);
  assert.ok(stats.terms >= 300, `expected >= 300 seed terms (roadmap E-0.6), got ${stats.terms}`);
  assert.equal(stats.forms.total, stats.forms.canonical + stats.forms.inflections);
  for (const c of ['programming', 'systems', 'networking', 'cloud', 'devops', 'data', 'ai', 'cybersecurity', 'hardware']) {
    assert.ok(stats.byCategory[c] > 0, `category ${c} has no terms`);
  }
});

test('the vision chain KUBERNETES -> DOCKER -> CONTAINER -> POD -> CLUSTER is connected in the graph', () => {
  const lex = loadLexicon();
  const edges = new Map();
  for (const f of lex.files) for (const t of f.data.terms) for (const r of t.relations ?? []) {
    for (const [a, b] of [[t.id, r.target], [r.target, t.id]]) edges.set(a, new Set([...(edges.get(a) ?? []), b]));
  }
  const chain = ['kubernetes', 'docker', 'container', 'pod', 'cluster'];
  for (let i = 0; i < chain.length - 1; i++) assert.ok(edges.get(chain[i])?.has(chain[i + 1]), `${chain[i]} - ${chain[i + 1]}`);
});

// ---------- v1 rules (kept) ----------

test('valid minimal term passes', () => {
  assert.deepEqual(run([term()]).errors, []);
});

test('rejects duplicate ids and duplicate playable forms', () => {
  const { errors } = run([term(), term({ id: 'docker-2' })]);
  assert.ok(has(errors, 'duplicate playable form', 'DOCKER', 'docker', 'docker-2'));
  assert.ok(has(run([term(), term()]).errors, 'duplicate id'));
});

test('rejects bad forms, unknown fields, missing owner on products and long definitions', () => {
  assert.ok(has(run([term({ form: 'K8S' })]).errors, 'form'));
  assert.ok(has(run([term({ colour: 'blue' })]).errors, 'unknown field'));
  assert.ok(has(run([term({ kind: 'product', owner: undefined })]).errors, 'owner'));
  assert.ok(has(run([term({ definitions: { en: 'x'.repeat(161), fr: 'ok ok ok ok' } })]).errors, 'definitions.en'));
});

test('rejects dangling, self and duplicate relations', () => {
  assert.ok(has(run([term({ relations: [{ type: 'uses', target: 'ghost' }] })]).errors, 'dangling'));
  assert.ok(has(run([term({ relations: [{ type: 'uses', target: 'docker' }] })]).errors, 'self relation'));
  const dup = [term({ relations: [{ type: 'uses', target: 'pod' }, { type: 'uses', target: 'pod' }] }), pod()];
  assert.ok(has(run(dup).errors, 'duplicate relation'));
});

test('detects is_a cycles', () => {
  const a = term({ id: 'a', form: 'AAA', kind: 'concept', relations: [{ type: 'is_a', target: 'b' }] });
  const b = term({ id: 'b', form: 'BBB', kind: 'concept', relations: [{ type: 'is_a', target: 'a' }] });
  assert.ok(has(run([a, b]).errors, 'is_a cycle'));
});

test('enforces computed values unless an approved override exists', () => {
  assert.ok(has(run([term({ gameValue: 999 })]).errors, 'gameValue'));
  assert.deepEqual(run([term({ gameValue: 999, override: { gameValue: 999, approvedBy: 'game-designer' } })]).errors, []);
});

test('rejects blocklisted canonical forms and primary category mismatch', () => {
  assert.ok(has(run([term()], new Set(['DOCKER'])).errors, 'blocklisted', 'DOCKER', 'docker'));
  assert.ok(has(run([term({ categories: ['cloud', 'devops'] })]).errors, 'primary category'));
});

// ---------- schema v2: AC-1 ----------

test('AC-1: a term with a plural inflection passes and stats split canonical / inflection / total forms', () => {
  const { errors, stats } = run([term(), pod()]);
  assert.deepEqual(errors, []);
  assert.deepEqual(stats.forms, { canonical: 2, inflections: 1, total: 3 });
  assert.deepEqual(stats.byInflectionKind, { plural: 1, verb_s: 0, verb_ed: 0, verb_ing: 0 });
});

test('AC-1: all four inflection kinds are accepted by the schema', () => {
  const deploy = term({
    id: 'deploy', form: 'DEPLOY', kind: 'concept', owner: undefined,
    inflections: [
      { form: 'DEPLOYED', kind: 'verb_ed' }, { form: 'DEPLOYING', kind: 'verb_ing' }, { form: 'DEPLOYS', kind: 'verb_s' },
    ],
  });
  assert.deepEqual(run([deploy]).errors, []);
});

test('playableForms resolves every form to its canonical term, sorted by form', () => {
  const lex = { categories, blocklist: new Set(), files: [file([term(), pod()])] };
  assert.deepEqual(playableForms(lex), [
    { form: 'DOCKER', termId: 'docker', kind: 'canonical' },
    { form: 'POD', termId: 'pod', kind: 'canonical' },
    { form: 'PODS', termId: 'pod', kind: 'plural' },
  ]);
});

// ---------- AC-2: versions ----------

test('AC-2: schema v1 files are rejected after the migration (and mixed v1/v2 lexicons with them)', () => {
  const v1 = { path: 'terms/cloud.json', data: { schemaVersion: 1, category: 'cloud', terms: [term({ id: 'aws', form: 'AWS', categories: ['cloud'] })] } };
  const { errors } = runFiles([file([term()]), v1]);
  assert.ok(has(errors, 'terms/cloud.json', 'schemaVersion must be 2', 'migrate-v1-to-v2'));
  assert.equal(errors.length, 1);
});

// ---------- AC-3: one global namespace ----------

test('AC-3: an inflection equal to a canonical form in another file fails once, naming the form and both term ids (D-5)', () => {
  const ids = term({ id: 'ids', form: 'IDS', kind: 'acronym', owner: undefined, categories: ['cloud'] });
  const id = term({ id: 'id', form: 'ID', kind: 'acronym', owner: undefined, inflections: [{ form: 'IDS', kind: 'plural' }] });
  const cloud = { path: 'terms/cloud.json', data: { schemaVersion: 2, category: 'cloud', terms: [ids] } };
  for (const files of [[file([id]), cloud], [cloud, file([id])]]) {
    const { errors } = runFiles(files);
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.ok(has(errors, '"IDS"', 'terms/devops.json#id', 'ids', 'standalone term owns the string'));
  }
});

test('AC-3: two terms declaring the same inflection fail, naming both term ids', () => {
  const a = term({ id: 'proxy', form: 'PROXY', kind: 'concept', owner: undefined, inflections: [{ form: 'PROXIES', kind: 'plural' }] });
  const b = term({ id: 'proxie', form: 'PROXIE', kind: 'concept', owner: undefined, inflections: [{ form: 'PROXIES', kind: 'plural' }] });
  const { errors } = run([a, b]);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.ok(has(errors, '"PROXIES"', 'proxy', 'proxie'));
});

// ---------- AC-4: shape rules ----------

test('AC-4: inflection form must match ^[A-Z]{2,15}$', () => {
  for (const form of ['pods', 'POD5', 'PODS-X', 'A', 'PODSPODSPODSPODS']) {
    assert.ok(has(run([pod({ inflections: [{ form, kind: 'plural' }] })]).errors, 'inflection', 'form'), form);
  }
});

test('AC-4: inflection must differ from the term own form', () => {
  assert.ok(has(run([pod({ inflections: [{ form: 'POD', kind: 'plural' }] })]).errors, 'equals the term form'));
});

test('AC-4: inflection kind must be in the v2 enum', () => {
  assert.ok(has(run([pod({ inflections: [{ form: 'PODS', kind: 'comparative' }] })]).errors, 'inflection kind'));
  assert.ok(has(run([pod({ inflections: [{ form: 'PODS' }] })]).errors, 'inflection kind'));
});

test('AC-4: inflection entries allow only { form, kind }', () => {
  assert.ok(has(run([pod({ inflections: [{ form: 'PODS', kind: 'plural', definition: 'x' }] })]).errors, 'unknown inflection field'));
  assert.ok(has(run([pod({ inflections: 'PODS' })]).errors, 'inflections must be an array'));
});

test('AC-4: owning term must be playable and have a form', () => {
  assert.ok(has(run([pod({ playable: false })]).errors, 'playable'));
  assert.ok(has(run([pod({ playable: false, form: undefined })]).errors, 'playable'));
});

test('AC-4 / D-6: no inflections on product or language terms', () => {
  assert.ok(has(run([pod({ kind: 'product', owner: 'Acme' })]).errors, 'product'));
  assert.ok(has(run([pod({ kind: 'language' })]).errors, 'language'));
});

test('AC-4: inflection array without duplicates', () => {
  const errors = run([pod({ inflections: [{ form: 'PODS', kind: 'plural' }, { form: 'PODS', kind: 'verb_s' }] })]).errors;
  assert.ok(has(errors, 'duplicate inflection', 'PODS'));
});

test('AC-4 / D-13: inflection array sorted by form (code-unit order)', () => {
  const errors = run([pod({ inflections: [{ form: 'PODS', kind: 'plural' }, { form: 'PODDED', kind: 'verb_ed' }] })]).errors;
  assert.ok(has(errors, 'sorted by form'));
});

test('AC-4 / D-6: at most 4 inflections per term', () => {
  const inflections = ['PODA', 'PODB', 'PODC', 'PODD', 'PODS'].map((form) => ({ form, kind: 'plural' }));
  assert.ok(has(run([pod({ inflections })]).errors, 'at most 4'));
  assert.deepEqual(run([pod({ inflections: inflections.slice(1) })]).errors, []);
});

test('AC-15 / D-7: two-letter forms are never inflections', () => {
  const o = term({ id: 'o-lang', form: 'OK', kind: 'concept', owner: undefined, inflections: [{ form: 'OS', kind: 'plural' }] });
  assert.ok(has(run([o]).errors, 'two-letter'));
});

// ---------- AC-5: blocklist on every form ----------

test('AC-5: a blocklisted inflection fails, naming the form and the term id', () => {
  assert.ok(has(run([pod()], new Set(['PODS'])).errors, 'blocklisted', 'PODS', 'pod'));
});

// ---------- AC-6: NEEDS_REVIEW warnings ----------

test('AC-6: irregular inflections warn NEEDS_REVIEW without failing', () => {
  const index = term({ id: 'index', form: 'INDEX', kind: 'concept', owner: undefined, inflections: [{ form: 'INDEXES', kind: 'plural' }, { form: 'INDICES', kind: 'plural' }] });
  const { errors, warnings } = run([index]);
  assert.deepEqual(errors, []);
  assert.ok(has(warnings, 'NEEDS_REVIEW', 'INDICES', 'does not start with'));
  assert.ok(!has(warnings, 'INDEXES'));
  const datum = term({ id: 'datum', form: 'DATUM', kind: 'concept', owner: undefined, inflections: [{ form: 'DATA', kind: 'plural' }] });
  assert.ok(has(run([datum]).warnings, 'NEEDS_REVIEW', 'DATA', 'does not end in S'));
});

test('AC-6: product, protocol and standard terms without sources warn NEEDS_REVIEW (D-11)', () => {
  for (const kind of ['product', 'protocol', 'standard']) {
    const { errors, warnings } = run([term({ kind })]);
    assert.deepEqual(errors, []);
    assert.ok(has(warnings, 'NEEDS_REVIEW', 'docker', 'sources'), kind);
    assert.deepEqual(run([term({ kind, sources: ['https://docs.docker.com/'] })]).warnings, []);
  }
  assert.deepEqual(run([term({ kind: 'tool' })]).warnings, []);
});

// ---------- AC-7: report ----------

test('AC-7: report snapshot on the fixture lexicon', () => {
  const k8s = term({ id: 'kubernetes', form: 'KUBERNETES', display: 'Kubernetes', difficulty: 'expert', owner: undefined, sources: ['https://kubernetes.io/'] });
  const ai = term({ id: 'ai', form: 'AI', display: 'AI', kind: 'acronym', owner: undefined, difficulty: 'novice', categories: ['cloud'] });
  const np = term({ id: 'cpp', form: undefined, display: 'C++', playable: false, kind: 'language', owner: undefined, categories: ['cloud'] });
  const lex = {
    categories, blocklist: new Set(['ZZZZ']),
    files: [file([term({ sources: ['https://docs.docker.com/'] }), pod(), k8s]), { path: 'terms/cloud.json', data: { schemaVersion: 2, category: 'cloud', terms: [ai, np] } }],
  };
  const report = buildReport(lex);
  assert.deepEqual(report, {
    lexiconVersion: report.lexiconVersion,
    cardsVersion: report.cardsVersion,
    schemaVersion: 2,
    valid: true,
    errors: [],
    warnings: [],
    terms: 5,
    relations: 0,
    forms: { canonical: 4, inflections: 1, total: 5 },
    byLength: { 2: 1, 3: 1, 4: 1, '5-7': 1, '8-10': 1, '11-15': 0 },
    byPrimaryCategory: { devops: 3, cloud: 1 },
    byDifficulty: { novice: 1, intermediate: 2, advanced: 0, expert: 1 },
    byInflectionKind: { plural: 1, verb_s: 0, verb_ed: 0, verb_ing: 0 },
    twoLetterForms: ['AI'],
  });
  assert.match(report.lexiconVersion, /^[0-9a-f]{16}$/);
  assert.match(report.cardsVersion, /^[0-9a-f]{16}$/);
  // Golden: pins the canonical document definition (LEXICON_SPEC §7). Update only with a contentFormat bump.
  assert.equal(report.lexiconVersion, '21a7a70536633cbb');
});
