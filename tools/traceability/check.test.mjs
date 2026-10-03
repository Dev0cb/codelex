import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  applyTable,
  BEGIN,
  END,
  parseGlobalProperties,
  parsePropertyLetters,
  parseRuleIds,
  renderTable,
  run,
  scanSource,
  validateScope,
} from './check.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const one = (src) => scanSource('x.test.ts', src);

// ---------- spec parsing ----------

test('parseRuleIds reads bullet definitions and table rows, once each, in order', () => {
  const text = [
    '- **R-CORE-001** A match has 2-4 players. See R-BAG-004 and R-NOPE-001.',
    '| R-POW-COMPILE | Compile | x |',
    '- **R-CORE-001** duplicate',
    '- **R-MODE-CLASSIC-002** (new v0.2)',
    'prose mentioning R-SCORE-001 only',
  ].join('\n');
  assert.deepEqual(parseRuleIds(text), ['R-CORE-001', 'R-POW-COMPILE', 'R-MODE-CLASSIC-002']);
});

test('parseGlobalProperties reads the P-GLOBAL table rows only', () => {
  const text = '| P-GLOBAL-01 | **Purity** | PBT |\n| P-GLOBAL-05 | **Tile conservation** | PBT |\nP-GLOBAL-07 in prose';
  assert.deepEqual(parseGlobalProperties(text), ['P-GLOBAL-01', 'P-GLOBAL-05']);
});

test('parsePropertyLetters lists the lettered properties of a rule row (a)..(g)', () => {
  const text = "| R-BAG-001 | (a) bag; (b) letters; (c) values; (d) table; (e) snapshot; (f) no code | PBT | G | GC |";
  assert.deepEqual(parsePropertyLetters(text).get('R-BAG-001'), ['a', 'b', 'c', 'd', 'e', 'f']);
});

// ---------- what counts as a tagged assertion ----------

test('a tagged test with a real matcher asserts', () => {
  const [t] = one("it('R-TURN-001: only listed actions', () => { expect(f()).toBe(1); });");
  assert.ok(t.rules.has('R-TURN-001'));
  assert.equal(t.asserts, true);
});

test('citation without any assertion does not assert (the R3 gap)', () => {
  const [t] = one("it('R-TURN-001: only listed actions', () => { f(); });");
  assert.ok(t.rules.has('R-TURN-001'));
  assert.equal(t.asserts, false);
});

test('expect(x) with no matcher, and expect(literal).matcher, are not assertions', () => {
  const [bare] = one("it('R-A-001 bare', () => { expect(f()); });");
  const [lit] = one("it('R-A-001 literal', () => { expect(true).toBe(true); });");
  const [lit2] = one("it('R-A-001 literal number', () => { expect(1).toBe(1); });");
  assert.equal(bare.asserts, false);
  assert.equal(lit.asserts, false);
  assert.equal(lit.assertions.vacuous, 1);
  assert.equal(lit2.asserts, false);
});

test('negated and chained matchers count (expect(x).not.toBe, .resolves, .toThrow)', () => {
  const [a] = one("it('R-A-001', () => { expect(f()).not.toBe(2); });");
  const [b] = one("it('R-A-001', async () => { await expect(p()).resolves.toBe(2); });");
  const [c] = one("it('R-A-001', () => { expect(() => f()).toThrow(); });");
  assert.deepEqual([a.asserts, b.asserts, c.asserts], [true, true, true]);
});

test('fc.assert, node assert and direct assert*/expect* helpers count; other helpers do not', () => {
  const [a] = one("it('R-A-001', () => { fc.assert(fc.property(fc.nat(), (n) => n >= 0)); });");
  const [b] = one("it('R-A-001', () => { assert.equal(f(), 1); });");
  const [c] = one("it('R-A-001', () => { expectRejected(f()); });");
  const [d] = one("it('R-A-001', () => { checkRejected(f()); });");
  const [e] = one("it('R-A-001', () => { assertConserved(f()); });");
  assert.deepEqual([a.asserts, b.asserts, c.asserts, d.asserts, e.asserts], [true, true, true, false, true]);
});

test('skipped, todo, conditional and failing-by-design tests are marked and never count', () => {
  const src = [
    "it.skip('R-A-001 a', () => { expect(f()).toBe(1); });",
    "it.todo('R-A-001 b', () => { expect(f()).toBe(1); });",
    "it.skipIf(c)('R-A-001 c', () => { expect(f()).toBe(1); });",
    "it.runIf(c)('R-A-001 d', () => { expect(f()).toBe(1); });",
    "it.fails('R-A-001 e', () => { expect(f()).toBe(1); });",
    "describe.skip('suite', () => { it('R-A-001 f', () => { expect(f()).toBe(1); }); });",
  ].join('\n');
  const tests = one(src);
  assert.equal(tests.length, 6);
  assert.ok(tests.every((t) => t.skipped));
});

test('a describe name tags the tests inside it; a test without assertion inside still does not count', () => {
  const src = "describe('R-END-001 going out', () => { it('a', () => { expect(f()).toBe(1); }); it('b', () => { g(); }); });";
  const [a, b] = one(src);
  assert.ok(a.rules.has('R-END-001') && a.asserts);
  assert.ok(b.rules.has('R-END-001') && !b.asserts);
});

test('@covers in a comment above the test, or inside its body, tags it; a plain comment mention does not', () => {
  const src = [
    '// @covers R-SCORE-004, P-GLOBAL-05',
    "it('above', () => { expect(f()).toBe(1); });",
    "it('inside', () => { /* @covers R-SCORE-006 */ expect(f()).toBe(1); });",
    "it('mention', () => { // R-SCORE-007 is discussed here",
    '  expect(f()).toBe(1); });',
  ].join('\n');
  const [above, inside, mention] = one(src);
  assert.ok(above.rules.has('R-SCORE-004') && above.globals.has('P-GLOBAL-05'));
  assert.ok(inside.rules.has('R-SCORE-006'));
  assert.equal(mention.rules.size, 0);
});

test('a comment above one test does not leak to the next test', () => {
  const src = "// @covers R-A-001\nit('first', () => { expect(f()).toBe(1); });\nit('second', () => { expect(f()).toBe(1); });";
  const [first, second] = one(src);
  assert.ok(first.rules.has('R-A-001'));
  assert.equal(second.rules.size, 0);
});

test('a property tag cites its rule (P-CORE-001-c cites R-CORE-001); P-GLOBAL ranges are not expanded', () => {
  const [a] = one("it('P-CORE-001-c: same seed same state', () => { expect(f()).toBe(1); });");
  assert.ok(a.propRules.has('R-CORE-001'));
  const [r] = one("it('P-GLOBAL-01..08 all of them', () => { expect(f()).toBe(1); });");
  assert.deepEqual([...r.globals], []);
  const [s] = one("it('P-GLOBAL-01…08 all of them', () => { expect(f()).toBe(1); });");
  assert.deepEqual([...s.globals], []);
});

test('explicit slash lists cite each property; ranges and prose neighbours cite none', () => {
  const [a] = one("it('P-GLOBAL-01/02 R-CORE-005: streams', () => { expect(f()).toBe(1); });");
  assert.deepEqual([...a.globals].sort(), ['P-GLOBAL-01', 'P-GLOBAL-02']);
  const [b] = one("it('P-GLOBAL-03 to P-GLOBAL-05', () => { expect(f()).toBe(1); });");
  assert.deepEqual([...b.globals].sort(), ['P-GLOBAL-03', 'P-GLOBAL-05']);
});

test('it.each, test(), options object and timeout arguments are all recognised', () => {
  const src = [
    "it.each([1, 2])('R-A-001 each %s', (n) => { expect(n).toBeGreaterThan(0); });",
    "test('R-A-002 test()', () => { expect(f()).toBe(1); });",
    "it('R-A-003 options', { timeout: 5 }, () => { expect(f()).toBe(1); });",
    "it('R-A-004 numeric timeout', () => { expect(f()).toBe(1); }, 10_000);",
  ].join('\n');
  const tests = one(src);
  assert.equal(tests.length, 4);
  assert.ok(tests.every((t) => t.asserts));
});

test('template-literal names are read', () => {
  const [t] = one("it(`R-A-001 ${String(n)} matches`, () => { expect(f()).toBe(1); });");
  assert.ok(t.rules.has('R-A-001'));
});

// ---------- analysis ----------

const RULES = ['R-A-001', 'R-A-002', 'R-A-003'];
const base = (tests, scope = { outOfScope: {}, partial: {} }) =>
  analyze({ ruleIds: RULES, globalIds: ['P-GLOBAL-05'], letters: new Map(), scope, tests });

test('analyze: a rule with only a mention is a GAP and names where it was mentioned', () => {
  const tests = [
    ...one("it('R-A-001 ok', () => { expect(f()).toBe(1); });"),
    ...one("it('R-A-002 mention only', () => { g(); });"),
    ...one("it('P-GLOBAL-05 ok', () => { expect(f()).toBe(1); });"),
  ];
  const report = base(tests);
  assert.deepEqual(report.rows.map((r) => r.status), ['covered', 'GAP', 'GAP']);
  assert.ok(report.problems.some((p) => p.startsWith('R-A-002') && p.includes('without an assertion')));
  assert.ok(report.problems.some((p) => p.startsWith('R-A-003')));
});

test('analyze: out-of-scope rules are not gaps; skipped tests never cover', () => {
  const tests = [
    ...one("it.skip('R-A-001 skipped', () => { expect(f()).toBe(1); });"),
    ...one("it('R-A-002 ok', () => { expect(f()).toBe(1); });"),
    ...one("it('P-GLOBAL-05 ok', () => { expect(f()).toBe(1); });"),
  ];
  const scope = { outOfScope: { 'R-A-003': { reason: 'later epic, not in Phase 1' } }, partial: {} };
  const report = base(tests, scope);
  assert.deepEqual(report.rows.map((r) => r.status), ['GAP', 'covered', 'out-of-scope']);
  assert.equal(report.skippedTests, 1);
});

test('analyze: a global property without a tagged assertion fails (P-GLOBAL-05 named)', () => {
  const report = base(one("it('R-A-001 R-A-002 R-A-003', () => { expect(f()).toBe(1); });"));
  assert.deepEqual(report.problems, ['P-GLOBAL-05: global property has no tagged assertion']);
});

test('analyze: citing a rule ID that GAME_RULES does not define is an error (typo or stale tag)', () => {
  const tests = [
    ...one("it('R-A-001 R-A-002 R-A-003 R-ZZZ-999', () => { expect(f()).toBe(1); });"),
    ...one("it('P-GLOBAL-05 P-GLOBAL-99', () => { expect(f()).toBe(1); });"),
  ];
  const problems = base(tests).problems;
  assert.ok(problems.some((p) => p.includes('unknown rule ID R-ZZZ-999')));
  assert.ok(problems.some((p) => p.includes('unknown global property P-GLOBAL-99')));
});

test('validateScope: needs a real reason, known IDs, and no ID both out of scope and partial', () => {
  assert.deepEqual(validateScope({ outOfScope: {}, partial: {} }, RULES), []);
  const bad = validateScope(
    {
      outOfScope: { 'R-A-001': { reason: 'todo' }, 'R-NOPE-001': { reason: 'a long enough reason' } },
      partial: { 'R-A-001': { reason: 'a long enough reason' } },
    },
    RULES,
  );
  assert.ok(bad.some((p) => p.includes('R-A-001') && p.includes('needs a reason')));
  assert.ok(bad.some((p) => p.includes('R-NOPE-001') && p.includes('not a rule ID')));
  assert.ok(bad.some((p) => p.includes('both outOfScope and partial')));
  assert.ok(validateScope(null, RULES).length > 0);
});

test('renderTable and applyTable: the generated block is replaced in place and is idempotent', () => {
  const report = base(one("it('R-A-001 P-GLOBAL-05', () => { expect(f()).toBe(1); });"));
  const table = renderTable(report);
  assert.match(table, /\| R-A-001 \| covered \|/);
  assert.match(table, /\| R-A-002 \| GAP \|/);
  const doc = `before\n${BEGIN}\nold\n${END}\nafter\n`;
  const once = applyTable(doc, table);
  assert.ok(once.startsWith('before\n') && once.endsWith('\nafter\n') && once.includes(table));
  assert.equal(applyTable(once, table), once);
  assert.equal(applyTable('no markers', table), undefined);
});

// ---------- the CLI over a fixture repository ----------

function fixture(testSource, { stale = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-trace-'));
  mkdirSync(join(dir, 'docs/game'), { recursive: true });
  mkdirSync(join(dir, 'packages/p'), { recursive: true });
  writeFileSync(join(dir, 'docs/game/GAME_RULES.md'), '- **R-A-001** one\n- **R-A-002** two\n');
  writeFileSync(
    join(dir, 'docs/game/RULE_PROPERTIES.md'),
    `| P-GLOBAL-05 | **Tile conservation** | PBT |\n| R-A-001 | (a) x; (b) y | PBT | G | GC |\n\n${BEGIN}\n${stale ? 'stale' : ''}\n${END}\n`,
  );
  writeFileSync(
    join(dir, 'docs/game/rule-scope.json'),
    JSON.stringify({ outOfScope: { 'R-A-002': { reason: 'later epic, not in Phase 1' } }, partial: {} }),
  );
  writeFileSync(join(dir, 'packages/p/a.test.ts'), testSource);
  return dir;
}

const GOOD = "it('R-A-001 P-A-001-a P-GLOBAL-05', () => { expect(f()).toBe(1); });";

test('run: fails on a gap, passes once the tag sits in a test with an assertion, stays stale-checked', () => {
  const dir = fixture("it('R-A-001 P-GLOBAL-05', () => { f(); });");
  try {
    let r = run(dir, []);
    assert.equal(r.code, 1);
    assert.ok(r.problems.some((p) => p.startsWith('R-A-001') && p.includes('no tagged assertion')));
    assert.ok(r.problems.some((p) => p.startsWith('P-GLOBAL-05')));

    writeFileSync(join(dir, 'packages/p/a.test.ts'), GOOD);
    r = run(dir, []);
    assert.equal(r.code, 1, 'table is still stale');
    assert.ok(r.problems.every((p) => p.includes('stale')));

    r = run(dir, ['--write']);
    assert.equal(r.code, 0, r.problems.join('\n'));
    assert.match(readFileSync(join(dir, 'docs/game/RULE_PROPERTIES.md'), 'utf8'), /\| R-A-002 \| out-of-scope \|/);
    assert.equal(run(dir, []).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run: removing the assertion again fails the gate (no silent regressions)', () => {
  const dir = fixture(GOOD);
  try {
    assert.equal(run(dir, ['--write']).code, 0);
    writeFileSync(join(dir, 'packages/p/a.test.ts'), "it.skip('R-A-001 P-GLOBAL-05', () => { expect(f()).toBe(1); });");
    const r = run(dir, ['--write']);
    assert.equal(r.code, 1);
    assert.equal(r.problems.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run: a stale generated table fails the check', () => {
  const dir = fixture(GOOD, { stale: true });
  try {
    const r = run(dir, []);
    assert.equal(r.code, 1);
    assert.ok(r.problems.some((p) => p.includes('stale')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- this repository ----------

test('this repository: every Phase-1 rule has a tagged assertion; the Q4 named cases hold', () => {
  const r = run(REPO, ['--json']);
  assert.equal(r.code, 0, r.problems.join('\n'));
  const report = JSON.parse(r.out);
  const row = (id) => report.rows.find((x) => x.id === id);
  assert.equal(row('R-MODE-CLASSIC-001').status, 'covered');
  assert.equal(row('R-MODE-CLASSIC-002').status, 'covered');
  assert.equal(row('R-BOARD-003').status, 'out-of-scope');
  assert.match(row('R-BOARD-003').reason, /Tech squares/);
  assert.equal(report.globals.find((g) => g.id === 'P-GLOBAL-05').status, 'covered');
  assert.equal(report.rows.filter((x) => x.status === 'GAP').length, 0);
});

test('this repository: the generated table in RULE_PROPERTIES.md is fresh', () => {
  const r = run(REPO, []);
  assert.equal(r.code, 0, r.problems.join('\n'));
});
