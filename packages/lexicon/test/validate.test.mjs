import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLexicon, validateLexicon } from '../scripts/validate.mjs';

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
const run = (terms, blocklist = new Set()) =>
  validateLexicon({ categories, blocklist, files: [{ path: 'terms/devops.json', data: { schemaVersion: 1, category: 'devops', terms } }] });

test('the committed seed lexicon is valid', () => {
  const { errors, stats } = validateLexicon(loadLexicon());
  assert.deepEqual(errors, []);
  assert.ok(stats.terms >= 300, `expected >= 300 seed terms (roadmap E-0.6), got ${stats.terms}`);
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

test('valid minimal term passes', () => {
  assert.deepEqual(run([term()]).errors, []);
});

test('rejects duplicate ids and duplicate playable forms', () => {
  const { errors } = run([term(), term({ id: 'docker-2' })]);
  assert.ok(errors.some((e) => e.includes('duplicate playable form')));
  assert.ok(run([term(), term()]).errors.some((e) => e.includes('duplicate id')));
});

test('rejects bad forms, unknown fields, missing owner on products and long definitions', () => {
  assert.ok(run([term({ form: 'K8S' })]).errors.some((e) => e.includes('form')));
  assert.ok(run([term({ colour: 'blue' })]).errors.some((e) => e.includes('unknown field')));
  assert.ok(run([term({ kind: 'product', owner: undefined })]).errors.some((e) => e.includes('owner')));
  assert.ok(run([term({ definitions: { en: 'x'.repeat(161), fr: 'ok ok ok ok' } })]).errors.some((e) => e.includes('definitions.en')));
});

test('rejects dangling, self and duplicate relations', () => {
  assert.ok(run([term({ relations: [{ type: 'uses', target: 'ghost' }] })]).errors.some((e) => e.includes('dangling')));
  assert.ok(run([term({ relations: [{ type: 'uses', target: 'docker' }] })]).errors.some((e) => e.includes('self relation')));
  const dup = [term({ relations: [{ type: 'uses', target: 'pod' }, { type: 'uses', target: 'pod' }] }), term({ id: 'pod', form: 'POD', kind: 'concept' })];
  assert.ok(run(dup).errors.some((e) => e.includes('duplicate relation')));
});

test('detects is_a cycles', () => {
  const a = term({ id: 'a', form: 'AAA', kind: 'concept', relations: [{ type: 'is_a', target: 'b' }] });
  const b = term({ id: 'b', form: 'BBB', kind: 'concept', relations: [{ type: 'is_a', target: 'a' }] });
  assert.ok(run([a, b]).errors.some((e) => e.includes('is_a cycle')));
});

test('enforces computed values unless an approved override exists', () => {
  assert.ok(run([term({ gameValue: 999 })]).errors.some((e) => e.includes('gameValue')));
  assert.deepEqual(run([term({ gameValue: 999, override: { gameValue: 999, approvedBy: 'game-designer' } })]).errors, []);
});

test('rejects blocklisted forms and primary category mismatch', () => {
  assert.ok(run([term()], new Set(['DOCKER'])).errors.some((e) => e.includes('blocklisted')));
  assert.ok(run([term({ categories: ['cloud', 'devops'] })]).errors.some((e) => e.includes('primary category')));
});
