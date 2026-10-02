// Canonical JSON (RFC 8785) and lexiconVersion / cardsVersion (ADR-0013 §D7, LEXICON_SPEC §7).
// Property tests use a local seeded PRNG so the package stays zero-dependency (runs before `pnpm install`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalize,
  computeCardsVersion,
  computeLexiconVersion,
  lexiconContentDocument,
  sha256Hex16,
} from '../scripts/canonical.mjs';
import { loadLexicon, validateLexicon } from '../scripts/validate.mjs';

// ---------- RFC 8785 ----------

test('JCS: ADR-0013 Appendix A.3 vector', () => {
  const input = JSON.parse('{"z":{"k":-7},"b":0,"a":[3,"?AE"]}');
  const jcs = canonicalize(input);
  assert.equal(jcs, '{"a":[3,"?AE"],"b":0,"z":{"k":-7}}');
  assert.equal(sha256Hex16(jcs), '29cb9747b6a72241');
});

test('JCS: RFC 8785 §3.2.2 primitives (numbers, string escapes, literals)', () => {
  const input = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
      '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
  );
  assert.equal(
    canonicalize(input),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test('JCS: RFC 8785 §3.2.3 property sorting by UTF-16 code units', () => {
  const input = JSON.parse(
    '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
      '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
  );
  // Object.keys() would list integer-like keys first, so the expectation is built as a string.
  const order = ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'];
  assert.equal(
    canonicalize(input),
    `{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(input[k])}`).join(',')}}`,
  );
});

test('JCS: rejects values outside JSON (undefined, NaN, Infinity, lone surrogates, non-plain objects)', () => {
  for (const bad of [
    undefined,
    NaN,
    Infinity,
    { a: undefined },
    ['\ud800'],
    new Date(0),
    () => 1,
    1n,
  ]) {
    assert.throws(() => canonicalize(bad), TypeError);
  }
  assert.equal(canonicalize(-0), '0');
  assert.throws(() => canonicalize({ '\ud800': 1 }), TypeError, 'lone surrogate in a key');
  assert.throws(() => canonicalize([1, , 3]), TypeError, 'sparse array hole');
  assert.throws(() => canonicalize(new Array(2)), TypeError, 'sparse array');
});

// ---------- lexiconVersion properties ----------

/** mulberry32: tiny seeded PRNG, test-only. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const shuffle = (r, xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CATS = ['ai', 'cloud', 'data', 'devops'];

/** Random but structurally valid lexicon (forms unique; inflections sorted, ≤ 4). */
function randomLexicon(r) {
  const n = 3 + Math.floor(r() * 8);
  const used = new Set();
  const freshForm = (min = 3) => {
    for (;;) {
      const len = min + Math.floor(r() * 6);
      let s = '';
      for (let i = 0; i < len; i++) s += pick(r, LETTERS);
      if (!used.has(s) && !used.has(`${s}S`) && !['ZZZQ', 'QQQZ'].includes(s)) {
        used.add(s);
        return s;
      }
    }
  };
  const terms = [];
  for (let i = 0; i < n; i++) {
    const form = freshForm();
    const kind = pick(r, ['concept', 'tool', 'acronym', 'product']);
    const t = {
      id: `t${i}`,
      form,
      display: form.toLowerCase(),
      playable: true,
      kind,
      categories: [pick(r, CATS)],
      difficulty: pick(r, ['novice', 'intermediate', 'advanced', 'expert']),
      definitions: {
        en: `Definition number ${i} in English.`,
        fr: `Définition numéro ${i} en français.`,
      },
    };
    if (kind === 'product') t.owner = 'Some Owner';
    const extra = CATS.filter((c) => c !== t.categories[0] && r() < 0.3);
    t.categories.push(...extra);
    if (kind !== 'product' && r() < 0.6) {
      const infl = [{ form: `${form}S`, kind: 'plural' }];
      used.add(`${form}S`);
      if (r() < 0.3 && !used.has(`${form}ING`)) {
        infl.push({ form: `${form}ING`, kind: 'verb_ing' });
        used.add(`${form}ING`);
      }
      t.inflections = infl.sort((a, b) => (a.form < b.form ? -1 : a.form > b.form ? 1 : 0));
    }
    if (r() < 0.5)
      t.tags = shuffle(r, ['season:s01', 'core', 'mission:x']).slice(0, 1 + Math.floor(r() * 3));
    terms.push(t);
  }
  for (const t of terms) {
    const rels = [];
    for (const u of terms)
      if (u.id !== t.id && r() < 0.3)
        rels.push({ type: pick(r, ['uses', 'related_to']), target: u.id });
    if (rels.length) t.relations = rels;
  }
  terms.push({
    id: 'np',
    display: 'C++',
    playable: false,
    kind: 'language',
    categories: ['ai'],
    difficulty: 'advanced',
    definitions: { en: 'A non playable language term.', fr: 'Un terme de langage non jouable.' },
  });
  const categories = CATS.map((id) => ({
    id,
    name: { en: id.toUpperCase(), fr: id },
    icon: 'x',
    colorToken: `category.${id}`,
  }));
  const byCat = new Map();
  for (const t of terms) byCat.set(t.categories[0], [...(byCat.get(t.categories[0]) ?? []), t]);
  const files = [...byCat].map(([category, ts]) => ({
    path: `data/terms/${category}.json`,
    data: { schemaVersion: 2, category, terms: ts },
  }));
  return { categories, files, blocklist: new Set(['ZZZQ', 'QQQZ']) };
}

/** Deep-reorders object keys at random (JSON semantics unchanged). */
function shuffleKeys(r, v) {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(r, x));
  if (v && typeof v === 'object')
    return Object.fromEntries(
      shuffle(r, Object.entries(v)).map(([k, x]) => [k, shuffleKeys(r, x)]),
    );
  return v;
}

/** Layout-only perturbation: key order, whitespace/CRLF round trip, file order, term order, tag/relation/secondary category/blocklist order. */
function perturb(r, lex) {
  const files = shuffle(r, lex.files).map(({ path, data }) => {
    const terms = shuffle(r, data.terms).map((t) => {
      const u = structuredClone(t);
      if (u.tags) u.tags = shuffle(r, u.tags);
      if (u.relations) u.relations = shuffle(r, u.relations);
      if (u.categories.length > 1)
        u.categories = [u.categories[0], ...shuffle(r, u.categories.slice(1))];
      return u;
    });
    const indent = pick(r, [0, 2, 4, '\t']);
    let raw = JSON.stringify(shuffleKeys(r, { ...data, terms }), null, indent);
    if (r() < 0.5) raw = raw.replace(/\n/g, '\r\n');
    return { path: path.replace(/\//g, pick(r, ['/', '\\'])), data: JSON.parse(raw) };
  });
  return {
    categories: shuffle(r, lex.categories).map((c) => shuffleKeys(r, c)),
    files,
    blocklist: new Set(shuffle(r, [...lex.blocklist])),
  };
}

const RUNS = 200;

test('property: lexiconVersion is invariant to key order, whitespace, CRLF, file/term order and unordered arrays', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = prng(seed);
    const lex = randomLexicon(r);
    assert.deepEqual(
      validateLexicon(lex).errors,
      [],
      `seed ${seed}: generator must produce valid data`,
    );
    const v = computeLexiconVersion(lex);
    assert.match(v, /^[0-9a-f]{16}$/);
    assert.equal(computeLexiconVersion(perturb(r, lex)), v, `seed ${seed}`);
    assert.equal(
      computeCardsVersion(perturb(r, lex)),
      computeCardsVersion(lex),
      `seed ${seed} (cards)`,
    );
  }
});

test('property: moving a term to another file (file split) does not change lexiconVersion', () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = prng(seed);
    const lex = randomLexicon(r);
    const all = lex.files.flatMap((f) => f.data.terms);
    const k = Math.floor(r() * (all.length + 1));
    const split = {
      ...lex,
      files: [
        { path: 'a.json', data: { terms: all.slice(0, k) } },
        { path: 'b.json', data: { terms: all.slice(k) } },
      ],
    };
    assert.equal(computeLexiconVersion(split), computeLexiconVersion(lex), `seed ${seed}`);
  }
});

/** Applies `mutate` to one random playable term of a deep copy. */
function mutateOne(r, lex, mutate) {
  const copy = structuredClone({ ...lex, blocklist: [...lex.blocklist] });
  copy.blocklist = new Set(copy.blocklist);
  const playable = copy.files.flatMap((f) => f.data.terms).filter((t) => t.playable);
  mutate(pick(r, playable), copy);
  return copy;
}

test('property: lexiconVersion changes when playable content changes', () => {
  const mutations = {
    form: (t) => {
      t.form = `${t.form}QX`;
    },
    'inflection added': (t) => {
      t.inflections = [...(t.inflections ?? []), { form: `${t.form}XQZ`, kind: 'plural' }];
    },
    'inflection kind': (t) => {
      t.inflections = [{ form: `${t.form}XQZ`, kind: 'plural' }];
    },
    playable: (t) => {
      t.playable = false;
    },
    difficulty: (t) => {
      t.difficulty = t.difficulty === 'expert' ? 'novice' : 'expert';
    },
    kind: (t) => {
      t.kind = t.kind === 'standard' ? 'protocol' : 'standard';
    },
    'primary category': (t) => {
      t.categories = ['zz-new', ...t.categories];
    },
    relation: (t) => {
      t.relations = [...(t.relations ?? []), { type: 'is_a', target: 'np' }];
    },
    tag: (t) => {
      t.tags = [...(t.tags ?? []), 'pack:new'];
    },
    'gameValue override': (t) => {
      t.override = { gameValue: 999, approvedBy: 'game-designer' };
    },
    'category registry': (_t, lex) => {
      lex.categories.push({ id: 'zz-new', name: { en: 'New', fr: 'Nouveau' } });
    },
    blocklist: (_t, lex) => {
      lex.blocklist.add('QZQZ');
    },
  };
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = prng(seed);
    const lex = randomLexicon(r);
    const v = computeLexiconVersion(lex);
    for (const [name, m] of Object.entries(mutations)) {
      assert.notEqual(
        computeLexiconVersion(mutateOne(r, lex, m)),
        v,
        `seed ${seed}: ${name} must change the version`,
      );
    }
  }
});

test('changing only the kind of an existing inflection changes lexiconVersion', () => {
  const lex = randomLexicon(prng(3));
  const t = lex.files[0].data.terms.find((x) => x.playable);
  t.inflections = [{ form: `${t.form}XQZ`, kind: 'plural' }];
  const before = computeLexiconVersion(lex);
  t.inflections[0].kind = 'verb_s';
  assert.notEqual(computeLexiconVersion(lex), before);
});

test('property: lexiconVersion ignores display-only content; cardsVersion tracks it', () => {
  const mutations = {
    'definition en': (t) => {
      t.definitions.en += ' Fixed typo.';
    },
    'definition fr': (t) => {
      t.definitions.fr += ' Coquille.';
    },
    display: (t) => {
      t.display = `${t.display}!`;
    },
    owner: (t) => {
      t.owner = 'Another Owner';
    },
    sources: (t) => {
      t.sources = ['https://example.org/doc'];
    },
    aliases: (t) => {
      t.aliases = ['ALIAS'];
    },
    'category name': (_t, lex) => {
      lex.categories[0].name.fr = 'Renommé';
    },
    'category icon': (_t, lex) => {
      lex.categories[0].icon = 'other';
    },
  };
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = prng(seed);
    const lex = randomLexicon(r);
    const v = computeLexiconVersion(lex);
    const c = computeCardsVersion(lex);
    for (const [name, m] of Object.entries(mutations)) {
      const changed = mutateOne(r, lex, m);
      assert.equal(
        computeLexiconVersion(changed),
        v,
        `seed ${seed}: ${name} must not change lexiconVersion`,
      );
      assert.notEqual(
        computeCardsVersion(changed),
        c,
        `seed ${seed}: ${name} must change cardsVersion`,
      );
    }
  }
});

test('absent and empty optional arrays are the same content; approvedBy and computed fields are not authoring noise', () => {
  const lex = randomLexicon(prng(7));
  const v = computeLexiconVersion(lex);
  const t = lex.files[0].data.terms[0];
  const variant = mutateOne(prng(1), lex, () => {});
  const u = variant.files[0].data.terms[0];
  u.relations ??= [];
  u.tags ??= [];
  u.inflections ??= [];
  assert.equal(computeLexiconVersion(variant), v);
  // Writing the computed values explicitly is equivalent to leaving them out.
  const doc = lexiconContentDocument(lex).terms.find((x) => x.id === t.id);
  const explicit = mutateOne(prng(1), lex, () => {});
  Object.assign(explicit.files[0].data.terms[0], {
    gameValue: doc.gameValue,
    knowledgeXp: doc.knowledgeXp,
  });
  assert.equal(computeLexiconVersion(explicit), v);
  // The approver of an override is audit metadata, not content.
  const a = mutateOne(prng(1), lex, () => {});
  const b = mutateOne(prng(1), lex, () => {});
  a.files[0].data.terms[0].override = { gameValue: 5, approvedBy: 'game-designer' };
  b.files[0].data.terms[0].override = { gameValue: 5, approvedBy: 'liveops' };
  assert.equal(computeLexiconVersion(a), computeLexiconVersion(b));
});

test('canonical document lists exactly the playable-content fields (LEXICON_SPEC §7)', () => {
  const lex = {
    categories: [{ id: 'devops', name: { en: 'DevOps', fr: 'DevOps' }, icon: 'i' }],
    blocklist: new Set(['ZZZQ']),
    files: [
      {
        path: 'x',
        data: {
          schemaVersion: 2,
          category: 'devops',
          terms: [
            {
              id: 'pod',
              form: 'POD',
              display: 'Pod',
              playable: true,
              kind: 'concept',
              categories: ['devops'],
              difficulty: 'intermediate',
              definitions: { en: 'Smallest deployable unit.', fr: 'Plus petite unité déployable.' },
              inflections: [{ form: 'PODS', kind: 'plural' }],
              tags: ['season:s01', 'core'],
              aliases: ['K8S-POD'],
              sources: ['https://kubernetes.io/'],
              relations: [
                { type: 'uses', target: 'pod-x' },
                { type: 'is_a', target: 'pod-x' },
              ],
            },
          ],
        },
      },
    ],
  };
  assert.deepEqual(lexiconContentDocument(lex), {
    contentFormat: 1,
    categories: ['devops'],
    blocklist: ['ZZZQ'],
    terms: [
      {
        id: 'pod',
        playable: true,
        kind: 'concept',
        difficulty: 'intermediate',
        categories: ['devops'],
        form: 'POD',
        inflections: [{ form: 'PODS', kind: 'plural' }],
        tags: ['core', 'season:s01'],
        relations: [
          { type: 'is_a', target: 'pod-x' },
          { type: 'uses', target: 'pod-x' },
        ],
        gameValue: 10,
        knowledgeXp: 28,
      },
    ],
  });
});

test('loadLexicon version is identical across CRLF, indentation, file names and blocklist file split', () => {
  const r = prng(42);
  const lex = randomLexicon(r);
  const write = (dir, variant) => {
    mkdirSync(join(dir, 'terms'), { recursive: true });
    mkdirSync(join(dir, 'blocklist'), { recursive: true });
    const eol = variant ? '\r\n' : '\n';
    writeFileSync(
      join(dir, 'categories.json'),
      JSON.stringify(
        { schemaVersion: 1, categories: lex.categories },
        null,
        variant ? 4 : 2,
      ).replace(/\n/g, eol),
    );
    lex.files.forEach(({ data }, i) => {
      const name = variant
        ? `${String(lex.files.length - i).padStart(2, '0')}-${data.category}.json`
        : `${data.category}.json`;
      writeFileSync(
        join(dir, 'terms', name),
        JSON.stringify(variant ? shuffleKeys(r, data) : data, null, variant ? '\t' : 2).replace(
          /\n/g,
          eol,
        ),
      );
    });
    const bl = [...lex.blocklist];
    if (variant) {
      writeFileSync(
        join(dir, 'blocklist', 'en.txt'),
        `# header${eol}${bl[1].toLowerCase()}  ${eol}`,
      );
      writeFileSync(join(dir, 'blocklist', 'fr.txt'), `${eol}${bl[0]}${eol}${bl[1]}${eol}`);
    } else writeFileSync(join(dir, 'blocklist', 'en.txt'), `${bl.join('\n')}\n`);
  };
  const root = mkdtempSync(join(tmpdir(), 'clx-lexver-'));
  try {
    write(join(root, 'a'), false);
    write(join(root, 'b'), true);
    const a = loadLexicon(join(root, 'a'));
    const b = loadLexicon(join(root, 'b'));
    assert.equal(a.version, computeLexiconVersion(lex));
    assert.equal(b.version, a.version);
    assert.equal(b.cardsVersion, a.cardsVersion);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
