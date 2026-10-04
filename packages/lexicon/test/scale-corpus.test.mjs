// Seeded scale corpora for the size gate (lexicon-index note §5, task T8 / sprint 3 P7).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lexiconContentDocument } from '../scripts/canonical.mjs';
import { fitFormModel, scaleCorpus, seededRandom } from '../scripts/scale-corpus.mjs';
import { loadLexicon } from '../scripts/validate.mjs';

const lex = loadLexicon();
const { terms } = lexiconContentDocument(lex);
const formsOf = (list) =>
  list.filter((t) => t.playable).flatMap((t) => [t.form, ...t.inflections.map((i) => i.form)]);
// Sizes derive from the real lexicon: a real+synthetic corpus can never be smaller than the real one.
const realForms = formsOf(terms).length;
const realCanonical = terms.filter((t) => t.playable).length;
const sizesOf = (kind) =>
  kind === 'synthetic' ? [1_600, 2_000] : [realForms + 100, realForms + 500];

test('seededRandom is deterministic and in [0, 1)', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(
    xs,
    Array.from({ length: 1000 }, () => b()),
  );
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, seededRandom(8)));
});

test('fitFormModel reads the real rates (plurals, relations) and refuses an empty lexicon', () => {
  const model = fitFormModel(terms);
  assert.ok(model.pluralRate > 0.3 && model.pluralRate < 0.6, String(model.pluralRate));
  assert.ok(model.relationsPerTerm > 1 && model.relationsPerTerm < 3);
  assert.equal(
    model.lengths.reduce((a, b) => a + b, 0),
    realCanonical,
  );
  assert.throws(() => fitFormModel([]), RangeError);
});

for (const kind of ['synthetic', 'real+synthetic']) {
  test(`${kind}: exactly N unique, valid, non-blocklisted forms; deterministic per seed`, () => {
    for (const forms of sizesOf(kind)) {
      const corpus = scaleCorpus({ terms, blocklist: lex.blocklist, kind, forms, seed: 3 });
      const all = formsOf(corpus);
      assert.equal(all.length, forms);
      assert.equal(new Set(all).size, forms);
      for (const f of all) {
        assert.match(f, /^[A-Z]{2,15}$/);
        assert.ok(!lex.blocklist.has(f), f);
      }
      const ids = new Set(corpus.map((t) => t.id));
      assert.equal(ids.size, corpus.length);
      for (const t of corpus) for (const r of t.relations) assert.ok(ids.has(r.target), r.target);
      assert.deepEqual(
        scaleCorpus({ terms, blocklist: lex.blocklist, kind, forms, seed: 3 }),
        corpus,
      );
    }
    assert.notDeepEqual(
      scaleCorpus({ terms, kind, forms: sizesOf(kind)[0], seed: 1 }),
      scaleCorpus({ terms, kind, forms: sizesOf(kind)[0], seed: 2 }),
    );
  });
}

test('real+synthetic keeps every real term and refuses a size below the real lexicon', () => {
  const corpus = scaleCorpus({ terms, kind: 'real+synthetic', forms: realForms + 500 });
  const real = new Set(formsOf(terms));
  const all = new Set(formsOf(corpus));
  for (const f of real) assert.ok(all.has(f), f);
  assert.throws(() => scaleCorpus({ terms, kind: 'real+synthetic', forms: 100 }), RangeError);
  assert.throws(() => scaleCorpus({ terms, kind: 'other', forms: 2_000 }), RangeError);
});
