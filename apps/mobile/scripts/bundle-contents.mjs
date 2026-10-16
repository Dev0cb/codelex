// Proof that excepted toolchain packages stay out of the shipped bundles (docs/security/audit-exceptions.md, class
// "toolchain package in the prod dependency graph, proven absent from shipped artefacts"). Reads the source maps
// that `expo export --source-maps` writes next to each Hermes bundle. `packagesInSources` and `checkContents` are pure.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

// --- Preview-only code (DG1, diagnostics note §3.3; bundle-preview-only.json) ---------------------------------------

/**
 * Source-map `sources` that contain one of `patterns` (paths normalised to `/`). Workspace packages appear as
 * relative paths, not under `node_modules/`, so `packagesInSources` cannot see them.
 * @param {string[]} sources @param {string[]} patterns @returns {string[]}
 */
export function sourcesMatching(sources, patterns) {
  return sources.filter((source) => {
    const path = source.replaceAll('\\', '/');
    return patterns.some((pattern) => path.includes(pattern));
  });
}

/**
 * Markers whose ASCII bytes occur in `bytes` (Hermes keeps string literals verbatim in the bytecode string table).
 * @param {Uint8Array} bytes @param {string[]} markers @returns {string[]}
 */
export function markersIn(bytes, markers) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return markers.filter((marker) => buffer.includes(Buffer.from(marker, 'latin1')));
}

/** Every file under `dir`, recursively, as paths relative to it (sorted). */
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

/**
 * Per platform, everything `expo export` wrote under `_expo/static/js/<platform>/` (the main bundle named in
 * metadata.json, any split or extra bundle, every source map): `sources` is the union of every map's `sources`,
 * `bytes` every file's bytes (maps included, so a marker in `sourcesContent` is found), `bundleSize` the main
 * bundle's size. Fails closed (`sources` or `bytes` null) when the directory, the main bundle or its map is
 * missing, or when any map cannot be parsed.
 * @returns {Record<string, { sources: string[] | null, bytes: Uint8Array | null, bundleSize: number | null, files: number }>}
 */
export function readExportBundles(dir) {
  const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  /** @type {Record<string, { sources: string[] | null, bytes: Uint8Array | null, bundleSize: number | null, files: number }>} */
  const result = {};
  for (const [platform, files] of Object.entries(metadata.fileMetadata ?? {})) {
    const bundle = join(dir, files.bundle);
    const jsDir = join(dir, '_expo', 'static', 'js', platform);
    const missing = { sources: null, bytes: null, bundleSize: null, files: 0 };
    if (!existsSync(bundle) || !existsSync(`${bundle}.map`) || !existsSync(jsDir)) {
      result[platform] = missing;
      continue;
    }
    const names = filesUnder(jsDir);
    const paths = names.map((name) => join(jsDir, name));
    // The main bundle must be one of the scanned files, so nothing it contains escapes the scan.
    if (!paths.includes(bundle)) paths.push(bundle, `${bundle}.map`);
    /** @type {string[] | null} */
    let sources = [];
    const chunks = [];
    for (const path of paths) {
      const content = readFileSync(path);
      chunks.push(content, Buffer.from([0]));
      if (!path.endsWith('.map') || sources === null) continue;
      try {
        const parsed = JSON.parse(content.toString('utf8'));
        sources = Array.isArray(parsed?.sources) ? [...sources, ...parsed.sources] : null;
      } catch {
        sources = null;
      }
    }
    result[platform] = {
      sources,
      bytes: new Uint8Array(Buffer.concat(chunks)),
      bundleSize: readFileSync(bundle).length,
      files: paths.length,
    };
  }
  return result;
}

/**
 * The production `expo config --json` (no diagnostics variable) must be app.json's app: no
 * `extra.codelexDiagnostics`, not the diagnostics identifier (DG1, S-m1). Fails closed on unparsable output.
 * @param {string} text @returns {{ ok: boolean, lines: string[] }}
 */
export function checkProductionConfig(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return { ok: false, lines: ['FAIL expo config: output is not JSON'] };
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, lines: ['FAIL expo config: output is not an object'] };
  }
  const lines = [];
  if (Object.hasOwn(config.extra ?? {}, 'codelexDiagnostics')) {
    lines.push('FAIL expo config: production config has extra.codelexDiagnostics');
  }
  for (const [name, id] of [
    ['ios.bundleIdentifier', config.ios?.bundleIdentifier],
    ['android.package', config.android?.package],
  ]) {
    if (typeof id === 'string' && id.endsWith('.diagnostics')) {
      lines.push(`FAIL expo config: production ${name} is ${id}`);
    }
  }
  if (lines.length > 0) return { ok: false, lines };
  return { ok: true, lines: ['ok   expo config: no diagnostics extra or identifier'] };
}

const usable = (entry) => Boolean(entry) && Array.isArray(entry.sources) && entry.bytes != null;

/**
 * Absence check (production): fails closed on a missing map or bundle, on an empty list, on any preview-only module
 * path and on any marker, for every listed platform.
 * @param {Record<string, { sources: string[] | null, bytes: Uint8Array | null }>} bundles
 * @param {{ modulePathPatterns: string[], markers: string[] }} previewOnly
 * @param {string[]} platforms
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkPreviewOnlyAbsent(bundles, previewOnly, platforms) {
  if (previewOnly.modulePathPatterns.length === 0 || previewOnly.markers.length === 0) {
    return { ok: false, lines: ['FAIL bundle-preview-only.json lists no pattern or no marker'] };
  }
  const lines = [];
  let ok = true;
  for (const platform of platforms) {
    const entry = bundles[platform];
    if (!usable(entry)) {
      ok = false;
      lines.push(`FAIL ${platform}: bundle or source map missing (build with --source-maps)`);
      continue;
    }
    const modules = sourcesMatching(entry.sources, previewOnly.modulePathPatterns);
    const markers = markersIn(entry.bytes, previewOnly.markers);
    if (modules.length === 0 && markers.length === 0) {
      lines.push(
        `ok   ${platform}: no preview-only module or marker (${entry.sources.length} modules)`,
      );
      continue;
    }
    ok = false;
    for (const m of modules.slice(0, 5)) lines.push(`FAIL ${platform}: preview-only module ${m}`);
    for (const m of markers) lines.push(`FAIL ${platform}: preview-only marker ${m} in the bundle`);
  }
  return { ok, lines };
}

/**
 * Positive control (preview-diagnostics export): requires a diagnostics module, a golden-runner module and every
 * marker, so the absence check is known to see what it looks for.
 * @param {{ sources: string[] | null, bytes: Uint8Array | null } | undefined} entry
 * @param {{ modulePathPatterns: string[], markers: string[] }} previewOnly
 * @param {string} platform
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkPreviewOnlyPresent(entry, previewOnly, platform) {
  if (!usable(entry))
    return { ok: false, lines: [`FAIL ${platform}: bundle or source map missing`] };
  const lines = [];
  let ok = true;
  const groups = [
    ['diagnostics module', ['apps/mobile/src/diagnostics/']],
    ['golden-runner module', ['packages/golden-runner/', 'node_modules/@codelex/golden-runner/']],
  ];
  for (const [name, patterns] of groups) {
    const found = sourcesMatching(entry.sources, patterns).length;
    if (found === 0) {
      ok = false;
      lines.push(
        `FAIL ${platform}: no ${name} in the diagnostics export (the absence proof is void)`,
      );
    } else {
      lines.push(`ok   ${platform}: ${String(found)} ${name}(s) present`);
    }
  }
  const markers = markersIn(entry.bytes, previewOnly.markers);
  for (const marker of previewOnly.markers) {
    if (markers.includes(marker)) {
      lines.push(`ok   ${platform}: marker ${marker} present`);
    } else {
      ok = false;
      lines.push(`FAIL ${platform}: marker ${marker} missing from the diagnostics export`);
    }
  }
  return { ok, lines };
}
