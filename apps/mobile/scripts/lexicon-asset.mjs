// `prepare:lexicon` (mobile-app-foundation note §3.1, lexicon-index note §3.4): copies the `.clxi` variant the app
// bundles and a small descriptor into assets/lexicon/. The artefact comes from `@codelex/lexicon#build:index` through
// the resolver, which refuses any file whose size or sha256 differs from the manifest. The runtime loader verifies
// the sha256 again on the device and decodes with the descriptor's version and profile (§3.2).
//
// Generated files are git-ignored (reproducible build outputs) and keep stable names so Metro can `require` them.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Profile bundled for the playtest (E-1.5). */
export const BUNDLED_PROFILE_ID = 'global-ranked';
/**
 * Header flags of the bundled variant, chosen explicitly: 1 = with the GADDAG (the bots' move generator), 0 = without
 * (bots fall back to the DAWG, about 2x slower). Stays 1 while the artefact fits `lexiconBytes` in
 * bundle-budget.json (the lexicon-index §5 size gate); switching to 0 is a reviewed decision, never automatic.
 */
export const BUNDLED_FLAGS = 1;
/** Stable asset names (Metro needs static `require` paths). */
export const ASSET_FILE = 'lexicon.clxi';
export const DESCRIPTOR_FILE = 'lexicon.json';

/**
 * Smallest `lexiconBytes` limit across platforms in a bundle budget.
 * @param {Record<string, unknown>} budget @returns {number}
 */
export function lexiconByteLimit(budget) {
  const limits = Object.entries(budget)
    .filter(([key]) => !key.startsWith('$'))
    .map(([, value]) =>
      typeof value === 'object' && value !== null && 'lexiconBytes' in value
        ? value.lexiconBytes
        : undefined,
    );
  if (limits.length === 0 || !limits.every((l) => typeof l === 'number' && Number.isFinite(l))) {
    throw new Error('bundle-budget.json: every platform needs a numeric lexiconBytes limit');
  }
  return Math.min(.../** @type {number[]} */ (limits));
}

/**
 * Resolves the bundled artefact and writes it plus its descriptor to `outDir`.
 * @param {{
 *   resolve: (which: { profileId: string, flags: number }) => {
 *     lexiconVersion: string, entry: { id: string, flags: number, sha256: string, bytes: number }, bytes: Uint8Array
 *   },
 *   outDir: string,
 *   maxBytes: number,
 *   profileId?: string,
 *   flags?: number,
 * }} options
 * @returns {{ lexiconVersion: string, profileId: string, flags: number, sha256: string, bytes: number }}
 */
export function prepareLexiconAsset({
  resolve,
  outDir,
  maxBytes,
  profileId = BUNDLED_PROFILE_ID,
  flags = BUNDLED_FLAGS,
}) {
  const { lexiconVersion, entry, bytes } = resolve({ profileId, flags });
  if (entry.id !== profileId || entry.flags !== flags || bytes.length !== entry.bytes) {
    throw new Error(`resolver returned ${entry.id} f${entry.flags} for ${profileId} f${flags}`);
  }
  if (bytes.length > maxBytes) {
    throw new Error(
      `${profileId}.f${flags}.clxi is ${bytes.length} B, over the ${maxBytes} B lexiconBytes budget ` +
        '(lexicon-index note §5). Bundling f0 (no GADDAG) or CDN delivery is a reviewed decision: ' +
        'see mobile-app-foundation note §3.1.',
    );
  }
  const descriptor = { lexiconVersion, profileId, flags, sha256: entry.sha256, bytes: entry.bytes };
  mkdirSync(outDir, { recursive: true });
  // Write then rename: a crash mid-copy never leaves a truncated asset under the final name.
  const write = (name, data) => {
    const tmp = join(outDir, `.${name}.tmp`);
    writeFileSync(tmp, data);
    renameSync(tmp, join(outDir, name));
  };
  write(ASSET_FILE, bytes);
  write(DESCRIPTOR_FILE, `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

/**
 * Reads a budget file and returns its lexicon byte limit.
 * @param {string} path @returns {number}
 */
export function readLexiconByteLimit(path) {
  return lexiconByteLimit(JSON.parse(readFileSync(path, 'utf8')));
}
