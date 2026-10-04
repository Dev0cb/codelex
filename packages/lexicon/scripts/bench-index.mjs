#!/usr/bin/env node
// Index benchmarks as JSON (lexicon-index note §5, task T8, sprint L6 stretch). Measures the artefacts of the
// `build:index` output itself (both flags variants), so the numbers describe the bytes that ship:
//   dist/bench/index-bench.json
// Reporting only: it never fails on a slow result. The hard gates stay in test/index-speed.test.mjs
// (has() 10 µs, crossCheck 50 µs) and are not duplicated here. CI uploads the file as an artefact for trending.
// Needs `build` and `build:index` first (Turborepo `bench:index` depends on both).
// Also reports the size gate (scripts/size-gate.mjs) of each artefact and a scale table: f1/f0 bytes of seeded
// `synthetic` and `real+synthetic` corpora (scripts/scale-corpus.mjs) at SCALE_FORMS (sprint 3 P7, note §5.1).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { lexiconContentDocument } from './canonical.mjs';
import { readIndexManifest, resolveIndexArtefact } from './indexes.mjs';
import { SCALE_CORPUS_KINDS, scaleCorpus } from './scale-corpus.mjs';
import { SIZE_GATE, sizeGateFailures } from './size-gate.mjs';
import { loadLexicon } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildLexiconIndex, decodeLexiconIndex } = await import('../dist/index/index.js');

const BATCHES = 5;
const SCALE_FORMS = [2_000, 2_500, 3_000];
const SCALE_SEED = 1;

/** Byte length of the sections at these indexes of the header section table (format.ts SECTIONS order). */
const sectionBytes = (bytes, ...indexes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return indexes.reduce((sum, i) => sum + view.getUint32(56 + i * 8 + 4, true), 0);
};
const DAWG_SECTIONS = [11, 12];
const GADDAG_SECTIONS = [13, 14];
const gateOf = (bytes, forms, gaddag) =>
  sizeGateFailures({
    bytes: bytes.length,
    forms,
    gaddag,
    ...(gaddag
      ? {
          dawgBytes: sectionBytes(bytes, ...DAWG_SECTIONS),
          gaddagBytes: sectionBytes(bytes, ...GADDAG_SECTIONS),
        }
      : {}),
  });

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
    bytesPerForm: Math.round((entry.bytes / index.size) * 10) / 10,
    sizeGateFailures: gateOf(bytes, index.size, entry.gaddag),
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

// Scale table: same builder, seeded corpora, both variants. Reporting only; the hard gate on the real artefact and
// on the real+synthetic projection lives in src/index/clxi/clxi.test.ts.
const lex = loadLexicon();
const { terms: realTerms } = lexiconContentDocument(lex);
const profile = { id: 'global-ranked', kind: 'global', definitionHash: '0000000000000000' };
const scale = [];
for (const kind of SCALE_CORPUS_KINDS) {
  for (const forms of SCALE_FORMS) {
    const terms = scaleCorpus({
      terms: realTerms,
      blocklist: lex.blocklist,
      kind,
      forms,
      seed: SCALE_SEED,
    });
    const row = { kind, forms, seed: SCALE_SEED };
    for (const gaddag of [true, false]) {
      const start = performance.now();
      const result = buildLexiconIndex(
        {
          version: '0000000000000000',
          profile,
          document: { terms },
          blocklist: [...lex.blocklist],
        },
        { formatVersion: 1, gaddag },
      );
      const buildMs = Math.round(performance.now() - start);
      if (!result.ok)
        throw new Error(`bench:index: scale ${kind} ${forms}: ${result.error.message}`);
      const b = result.value;
      const key = gaddag ? 'f1' : 'f0';
      row[key] = {
        bytes: b.length,
        bytesPerForm: Math.round((b.length / forms) * 10) / 10,
        buildMs,
        sizeGateFailures: gateOf(b, forms, gaddag),
      };
      if (gaddag) {
        const dawg = sectionBytes(b, ...DAWG_SECTIONS);
        const gaddagBytes = sectionBytes(b, ...GADDAG_SECTIONS);
        row.f1.dawgBytes = dawg;
        row.f1.gaddagBytes = gaddagBytes;
        row.f1.gaddagToDawg = Math.round((gaddagBytes / dawg) * 100) / 100;
      }
    }
    scale.push(row);
  }
}

const report = {
  lexiconVersion,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  batches: BATCHES,
  note: 'median ns per call over all forms (hits) and form+Q (misses); reporting only, gates live in test/index-speed.test.mjs',
  results,
  sizeGate: SIZE_GATE,
  scaleNote:
    'seeded corpora fitted on the real lexicon (scripts/scale-corpus.mjs): synthetic = generated terms only, real+synthetic = real terms plus generated ones; they show scaling trends, not real sharing ratios',
  scale,
};
const outDir = join(ROOT, 'dist', 'bench');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index-bench.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
