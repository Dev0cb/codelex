#!/usr/bin/env node
// Index benchmarks as JSON (lexicon-index note §5, task T8, sprint L6 stretch). Measures the artefacts of the
// `build:index` output itself (both flags variants), so the numbers describe the bytes that ship:
//   dist/bench/index-bench.json
// Reporting only: it never fails on a slow result. The hard gates stay in test/index-speed.test.mjs
// (has() 10 µs, crossCheck 50 µs) and are not duplicated here. CI uploads the file as an artefact for trending.
// Needs `build` and `build:index` first (Turborepo `bench:index` depends on both).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { readIndexManifest, resolveIndexArtefact } from './indexes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { decodeLexiconIndex } = await import('../dist/index/index.js');

const BATCHES = 5;

/** Median over BATCHES timed runs after one warm-up; `fn` returns the number of operations it performed. */
const median = (fn) => {
  fn();
  const samples = [];
  for (let b = 0; b < BATCHES; b += 1) {
    const start = performance.now();
    const ops = fn();
    samples.push(((performance.now() - start) * 1e6) / ops);
  }
  samples.sort((a, b) => a - b);
  return Math.round(samples[Math.floor(BATCHES / 2)] * 10) / 10;
};

const codesOf = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) - 65);

const { lexiconVersion, profiles } = readIndexManifest();
const results = [];
for (const entry of profiles) {
  const { bytes } = resolveIndexArtefact({ profileId: entry.id, flags: entry.flags });
  const decodeNs = median(() => {
    for (let r = 0; r < 20; r += 1) {
      if (!decodeLexiconIndex(bytes, { version: lexiconVersion, profileId: entry.id }).ok) {
        throw new Error(`bench:index: ${entry.file} does not decode`);
      }
    }
    return 20;
  });
  const decoded = decodeLexiconIndex(bytes, { version: lexiconVersion, profileId: entry.id });
  if (!decoded.ok) throw new Error(`bench:index: ${entry.file} does not decode`);
  const index = decoded.value;
  const forms = Array.from({ length: index.size }, (_, i) => index.formMeta(i).form);
  const misses = forms.map((f) => `${f}Q`);
  const formCodes = forms.map(codesOf);
  const sink = { n: 0 };
  const loop = (items, op) => () => {
    for (let r = 0; r < 50; r += 1) for (const item of items) if (op(item)) sink.n += 1;
    return 50 * items.length;
  };
  const row = {
    profile: entry.id,
    flags: entry.flags,
    file: entry.file,
    bytes: entry.bytes,
    forms: index.size,
    decodeMs: Math.round(decodeNs / 1e3) / 1e3,
    hasHitNs: median(loop(forms, (f) => index.has(f))),
    hasMissNs: median(loop(misses, (f) => index.has(f))),
    lookupCodesHitNs: median(
      loop(formCodes, (c) => index.lookupCodes(c, 0, c.length) !== undefined),
    ),
  };
  if (entry.gaddag) {
    const contexts = formCodes.map((c, i) => {
      const cut = i % c.length;
      return [c.subarray(0, cut), c.subarray(cut + 1)];
    });
    row.crossCheckNs = median(
      loop(contexts, ([before, after]) => index.crossCheck(before, after) !== 0),
    );
  }
  results.push(row);
}

const report = {
  lexiconVersion,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  batches: BATCHES,
  note: 'median ns per call over all forms (hits) and form+Q (misses); reporting only, gates live in test/index-speed.test.mjs',
  results,
};
const outDir = join(ROOT, 'dist', 'bench');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index-bench.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
