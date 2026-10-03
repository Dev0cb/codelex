// Bundle-size budget for the `expo export` output (no native build needed: Metro + hermesc run on any CI host).
// `measureExport` reads dist/metadata.json; `checkBudget` is pure.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ bundleBytes: number, assetBytes: number }} PlatformSizes
 * @typedef {Record<string, PlatformSizes>} Sizes
 */

/** Sizes per platform from an `expo export` output directory. @returns {Sizes} */
export function measureExport(dir) {
  const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  /** @type {Sizes} */
  const sizes = {};
  for (const [platform, files] of Object.entries(metadata.fileMetadata ?? {})) {
    const size = (rel) => statSync(join(dir, rel)).size;
    sizes[platform] = {
      bundleBytes: size(files.bundle),
      assetBytes: (files.assets ?? []).reduce((sum, asset) => sum + size(asset.path), 0),
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
    for (const metric of ['bundleBytes', 'assetBytes']) {
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
