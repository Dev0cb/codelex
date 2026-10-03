// Bundle-size budget for the `expo export` output (no native build needed: Metro + hermesc run on any CI host).
// `measureExport` reads dist/metadata.json; `checkBudget` and `checkBundledLexicon` are pure.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Metro asset extension of the lexicon index (metro.config.cjs). */
export const LEXICON_EXT = 'clxi';
const METRICS = ['bundleBytes', 'assetBytes', 'lexiconBytes'];

/**
 * @typedef {{ bundleBytes: number, assetBytes: number, lexiconBytes: number, lexiconFiles: string[] }} PlatformSizes
 * @typedef {Record<string, PlatformSizes>} Sizes
 */

/**
 * Sizes per platform from an `expo export` output directory. The `.clxi` lexicon index is measured on its own line
 * (`lexiconBytes`, its paths in `lexiconFiles`) and excluded from `assetBytes` (code assets: fonts, images).
 * @returns {Sizes}
 */
export function measureExport(dir) {
  const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  /** @type {Sizes} */
  const sizes = {};
  for (const [platform, files] of Object.entries(metadata.fileMetadata ?? {})) {
    const size = (rel) => statSync(join(dir, rel)).size;
    const assets = files.assets ?? [];
    const lexicon = assets.filter((asset) => asset.ext === LEXICON_EXT);
    const other = assets.filter((asset) => asset.ext !== LEXICON_EXT);
    sizes[platform] = {
      bundleBytes: size(files.bundle),
      assetBytes: other.reduce((sum, asset) => sum + size(asset.path), 0),
      lexiconBytes: lexicon.reduce((sum, asset) => sum + size(asset.path), 0),
      lexiconFiles: lexicon.map((asset) => asset.path),
    };
  }
  return sizes;
}

/**
 * Compares measured sizes with the budget. A platform in the budget but missing from the export is an error (a
 * silently skipped platform would pass any budget). @returns {{ ok: boolean, lines: string[] }}
 */
export function checkBudget(sizes, budget) {
  const lines = [];
  let ok = true;
  for (const [platform, limits] of Object.entries(budget)) {
    if (platform.startsWith('$')) continue;
    const measured = sizes[platform];
    if (measured === undefined) {
      ok = false;
      lines.push(`FAIL ${platform}: not in the export`);
      continue;
    }
    for (const metric of METRICS) {
      const limit = limits[metric];
      if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        ok = false;
        lines.push(`FAIL ${platform}.${metric}: no budget`);
        continue;
      }
      const value = measured[metric];
      const pass = value <= limit;
      if (!pass) ok = false;
      const pct = ((100 * value) / limit).toFixed(1);
      lines.push(
        `${pass ? 'ok  ' : 'FAIL'} ${platform}.${metric}: ${value} / ${limit} B (${pct} %)`,
      );
    }
  }
  return { ok, lines };
}

/**
 * Proves that each platform bundles exactly one lexicon index and that it is the very artefact the descriptor
 * (assets/lexicon/lexicon.json, inlined in the JS bundle) names: same size and sha256. Otherwise the app would
 * show the corrupt-index state on every launch.
 * @param {Sizes} sizes
 * @param {{ sha256: string, bytes: number }} descriptor
 * @param {(path: string) => { bytes: number, sha256: string }} inspect size and sha256 of an exported file
 * @param {string[]} platforms
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkBundledLexicon(sizes, descriptor, inspect, platforms) {
  const lines = [];
  let ok = true;
  for (const platform of platforms) {
    const files = sizes[platform]?.lexiconFiles ?? [];
    if (files.length !== 1) {
      ok = false;
      lines.push(
        `FAIL ${platform}: ${files.length} .${LEXICON_EXT} assets in the export, expected 1`,
      );
      continue;
    }
    const [file] = files;
    const actual = inspect(file);
    if (actual.bytes !== descriptor.bytes || actual.sha256 !== descriptor.sha256) {
      ok = false;
      lines.push(
        `FAIL ${platform}: ${file} is ${actual.bytes} B sha256 ${actual.sha256}; descriptor says ` +
          `${descriptor.bytes} B ${descriptor.sha256}`,
      );
      continue;
    }
    lines.push(
      `ok   ${platform}: lexicon index ${file} matches the descriptor (${actual.bytes} B)`,
    );
  }
  return { ok, lines };
}
