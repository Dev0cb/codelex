// Proof that excepted toolchain packages stay out of the shipped bundles (docs/security/audit-exceptions.md, class
// "toolchain package in the prod dependency graph, proven absent from shipped artefacts"). Reads the source maps
// that `expo export --source-maps` writes next to each Hermes bundle. `packagesInSources` and `checkContents` are pure.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Package names of the modules in a source map's `sources` (the segment after each `node_modules/`, scoped names
 * included). The pnpm virtual-store segment (`.pnpm/<name>@<version>…`) is not a package and is skipped.
 * @param {string[]} sources @returns {Set<string>}
 */
export function packagesInSources(sources) {
  const found = new Set();
  for (const source of sources) {
    const parts = source.replaceAll('\\', '/').split('/');
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (parts[i] !== 'node_modules') continue;
      const first = parts[i + 1] ?? '';
      if (first === '' || first === '.pnpm') continue;
      const second = parts[i + 2];
      found.add(first.startsWith('@') && second !== undefined ? `${first}/${second}` : first);
    }
  }
  return found;
}

/**
 * Source-map `sources` per platform from an `expo export` output directory. A platform without a map yields
 * `null` so the check fails closed (a missing map would otherwise prove nothing).
 * @returns {Record<string, string[] | null>}
 */
export function readExportSources(dir) {
  const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  /** @type {Record<string, string[] | null>} */
  const result = {};
  for (const [platform, files] of Object.entries(metadata.fileMetadata ?? {})) {
    const mapFile = join(dir, `${files.bundle}.map`);
    result[platform] = existsSync(mapFile)
      ? JSON.parse(readFileSync(mapFile, 'utf8')).sources
      : null;
  }
  return result;
}

/**
 * @param {Record<string, string[] | null>} sourcesByPlatform
 * @param {{ name: string, advisory: string }[]} forbidden
 * @param {string[]} platforms platforms that must be present
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkContents(sourcesByPlatform, forbidden, platforms) {
  const lines = [];
  let ok = true;
  if (forbidden.length === 0) {
    return {
      ok: false,
      lines: ['FAIL no forbidden packages listed (bundle-forbidden-packages.json)'],
    };
  }
  for (const platform of platforms) {
    const sources = sourcesByPlatform[platform];
    if (sources === undefined || sources === null || !Array.isArray(sources)) {
      ok = false;
      lines.push(`FAIL ${platform}: no source map in the export (build with --source-maps)`);
      continue;
    }
    const present = packagesInSources(sources);
    for (const { name, advisory } of forbidden) {
      if (present.has(name)) {
        ok = false;
        lines.push(`FAIL ${platform}: ${name} is in the bundle; the ${advisory} exception is void`);
      } else {
        lines.push(`ok   ${platform}: ${name} absent (${sources.length} modules)`);
      }
    }
  }
  return { ok, lines };
}

/**
 * Size guard: packages that must stay out of the shipped bundles (bundle-must-be-absent.json). Same source-map proof
 * as {@link checkContents}, separate list and message: these are budget decisions, not audit exceptions.
 * @param {Record<string, string[] | null>} sourcesByPlatform
 * @param {{ name: string, reason: string }[]} absent
 * @param {string[]} platforms platforms that must be present
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkAbsent(sourcesByPlatform, absent, platforms) {
  const lines = [];
  let ok = true;
  for (const platform of platforms) {
    const sources = sourcesByPlatform[platform];
    if (sources === undefined || sources === null || !Array.isArray(sources)) {
      ok = false;
      lines.push(`FAIL ${platform}: no source map in the export (build with --source-maps)`);
      continue;
    }
    const present = packagesInSources(sources);
    for (const { name, reason } of absent) {
      if (present.has(name)) {
        ok = false;
        lines.push(`FAIL ${platform}: ${name} is in the bundle (${reason})`);
      } else {
        lines.push(`ok   ${platform}: ${name} absent (size guard)`);
      }
    }
  }
  return { ok, lines };
}
