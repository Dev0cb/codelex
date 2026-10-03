// has() speed gate (lexicon-index note §5: < 5 µs per call on Node; hard gate at 2× = 10 µs because CI runners
// are noisy). It measures the compiled dist/ build with plain node:test: running it under vitest's v8 coverage
// instrumentation inflates the cost by two orders of magnitude and would measure the instrumentation, not the
// code that ships. `pnpm test` runs after `build` (turbo dependsOn).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GLOBAL_PROFILE,
  computeLexiconVersion,
  lexiconContentDocument,
  profileDefinitionHash,
} from '../scripts/canonical.mjs';
import { loadLexicon } from '../scripts/validate.mjs';

const { buildLexiconIndex, decodeLexiconIndex } = await import('../dist/index/index.js');

test('has() < 5 µs per call on the real lexicon (median of 5 batches, gate 10 µs)', () => {
  const lex = loadLexicon();
  const built = buildLexiconIndex(
    {
      version: computeLexiconVersion(lex),
      profile: {
        id: GLOBAL_PROFILE.id,
        kind: 'global',
        definitionHash: profileDefinitionHash(GLOBAL_PROFILE),
      },
      document: lexiconContentDocument(lex),
    },
    { formatVersion: 1, gaddag: false },
  );
  assert.ok(built.ok);
  const decoded = decodeLexiconIndex(built.value);
  assert.ok(decoded.ok);
  const index = decoded.value;
  const forms = Array.from({ length: index.size }, (_, i) => index.formMeta(i).form);
  const misses = forms.map((f) => `${f}Q`);
  const batch = () => {
    const start = performance.now();
    let hits = 0;
    for (let r = 0; r < 50; r += 1) {
      for (const f of forms) if (index.has(f)) hits += 1;
      for (const f of misses) if (index.has(f)) hits += 1;
    }
    assert.equal(hits, 50 * forms.length);
    return ((performance.now() - start) * 1000) / (100 * forms.length);
  };
  batch(); // warm-up (JIT)
  const samples = [batch(), batch(), batch(), batch(), batch()].sort((a, b) => a - b);
  console.log(
    `has(): median ${samples[2].toFixed(3)} µs per call over ${forms.length} forms + misses`,
  );
  assert.ok(samples[2] < 10, `has() median ${samples[2]} µs ≥ 10 µs`);
});
