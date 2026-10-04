// Size gate of the `.clxi` artefact and the pre-agreed f0 switch rule (lexicon-index note §5, sprint 3 task P7).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { F0_SWITCH, SIZE_GATE, bundledFlags, sizeGateFailures } from '../scripts/size-gate.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

const f1 = (over = {}) => ({
  bytes: 283_672,
  forms: 1_501,
  gaddag: true,
  dawgBytes: 38_936,
  gaddagBytes: 183_512,
  ...over,
});
const f0 = (over = {}) => ({ bytes: 100_160, forms: 1_501, gaddag: false, ...over });

test('gate values: 550,000 B cap, 215 B/form with the GADDAG, 128 without, 2,550-form batch-3 ceiling, 6x', () => {
  assert.deepEqual(SIZE_GATE, {
    maxBytes: 550_000,
    maxBytesPerFormWithGaddag: 215,
    maxBytesPerFormWithoutGaddag: 128,
    maxFormsWithGaddag: 2_550,
    maxGaddagToDawg: 6,
  });
  assert.ok(Object.isFrozen(SIZE_GATE));
});

test('the batch-3 ceiling is the cap divided by the f1 density gate, rounded down to 50 forms', () => {
  const ceiling = Math.floor(SIZE_GATE.maxBytes / SIZE_GATE.maxBytesPerFormWithGaddag / 50) * 50;
  assert.equal(SIZE_GATE.maxFormsWithGaddag, ceiling);
});

test('the byte cap is the mobile lexiconBytes budget on every platform (apps/mobile/bundle-budget.json)', () => {
  const budget = JSON.parse(
    readFileSync(join(PKG, '..', '..', 'apps', 'mobile', 'bundle-budget.json'), 'utf8'),
  );
  const platforms = Object.entries(budget).filter(([k]) => !k.startsWith('$'));
  assert.ok(platforms.length > 0);
  for (const [platform, limits] of platforms)
    assert.equal(limits.lexiconBytes, SIZE_GATE.maxBytes, platform);
});

test("today's artefacts (lexiconVersion 4fa5884050b4ea53) pass", () => {
  assert.deepEqual(sizeGateFailures(f1()), []);
  assert.deepEqual(sizeGateFailures(f0()), []);
});

test('f1: each gate fails on its own, at the first byte or form over the limit', () => {
  assert.deepEqual(sizeGateFailures(f1({ bytes: 215 * 2_550, forms: 2_550 })), []);
  assert.match(
    sizeGateFailures(f1({ bytes: 550_001, forms: 2_550 })).join('\n'),
    /550001 B > 550000 B/,
  );
  assert.deepEqual(sizeGateFailures(f1({ bytes: 215 * 2_000, forms: 2_000 })), []);
  assert.match(
    sizeGateFailures(f1({ bytes: 215 * 2_000 + 1, forms: 2_000 })).join('\n'),
    /B\/form > 215/,
  );
  assert.match(
    sizeGateFailures(f1({ bytes: 500_000, forms: 2_551 })).join('\n'),
    /2551 forms > 2550/,
  );
  assert.deepEqual(sizeGateFailures(f1({ gaddagBytes: 6 * 38_936 })), []);
  assert.match(
    sizeGateFailures(f1({ gaddagBytes: 6 * 38_936 + 1 })).join('\n'),
    /GADDAG .* > 6 x DAWG/,
  );
});

test('f0: the cap and 128 B/form apply; the form ceiling and the GADDAG ratio do not', () => {
  assert.deepEqual(sizeGateFailures(f0({ bytes: 128 * 4_000, forms: 4_000 })), []);
  assert.match(
    sizeGateFailures(f0({ bytes: 128 * 4_000 + 1, forms: 4_000 })).join('\n'),
    /B\/form > 128/,
  );
  assert.match(
    sizeGateFailures(f0({ bytes: 550_001, forms: 5_000 })).join('\n'),
    /550001 B > 550000 B/,
  );
});

test('rejects malformed measurements instead of passing them', () => {
  assert.throws(() => sizeGateFailures(f1({ forms: 0 })), RangeError);
  assert.throws(() => sizeGateFailures(f1({ bytes: -1 })), RangeError);
  assert.throws(() => sizeGateFailures(f1({ bytes: 1.5 })), RangeError);
  assert.throws(() => sizeGateFailures(f1({ dawgBytes: undefined })), RangeError);
});

test('f0 switch rule: keep f1 while it passes; switch to f0 when f1 fails, f0 passes and DAWG time <= 1.5x', () => {
  assert.deepEqual(F0_SWITCH, { maxGenerationTimeRatio: 1.5 });
  const over = f1({ bytes: 560_000, forms: 2_600 });
  const lean = f0({ bytes: 190_000, forms: 2_600 });
  assert.deepEqual(bundledFlags({ f1: f1(), f0: f0(), generationTimeRatio: 3 }), {
    flags: 1,
    decision: 'keep-f1',
    failures: [],
  });
  const switched = bundledFlags({ f1: over, f0: lean, generationTimeRatio: 1.5 });
  assert.equal(switched.flags, 0);
  assert.equal(switched.decision, 'switch-f0');
  assert.ok(switched.failures.length > 0);
  const slow = bundledFlags({ f1: over, f0: lean, generationTimeRatio: 1.51 });
  assert.equal(slow.flags, undefined);
  assert.equal(slow.decision, 'escalate');
  const tooBig = bundledFlags({
    f1: over,
    f0: f0({ bytes: 600_000, forms: 5_000 }),
    generationTimeRatio: 1.2,
  });
  assert.equal(tooBig.decision, 'escalate');
  assert.throws(
    () => bundledFlags({ f1: over, f0: lean, generationTimeRatio: Number.NaN }),
    RangeError,
  );
});
