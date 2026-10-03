// Consumer side of `build:index` (lexicon-index note §3.4, sprint L6): locates the current `.clxi` artefacts
// without knowing the lexiconVersion in advance, and refuses any artefact whose bytes differ from the manifest.
// Zero-dependency (node: built-ins only) so app build scripts (apps/mobile `prepare:lexicon`) can import it
// as `@codelex/lexicon/indexes` before anything else is built. It does not decode: loaders verify sha256 again on
// the device and call `decodeLexiconIndex` (§3.5).
//
// Layout written by scripts/build-index.mjs:
//   dist/indexes/current.json                       { lexiconVersion, manifest: "<lexiconVersion>/manifest.json" }
//   dist/indexes/<lexiconVersion>/manifest.json     { lexiconVersion, profiles: [ManifestEntry] }
//   dist/indexes/<lexiconVersion>/<profileId>.f<flags>.clxi
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of `packages/lexicon/dist/indexes` (the `build:index` Turborepo output). */
export const INDEXES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'indexes');

export class IndexArtefactError extends Error {
  /**
   * @param {'INDEX_NOT_BUILT' | 'INDEX_MANIFEST_INVALID' | 'INDEX_PROFILE_MISSING' | 'INDEX_SHA_MISMATCH'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'IndexArtefactError';
    this.code = code;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9a-f]{16}$/;
const FILE = /^[a-z0-9][a-z0-9-]*\.f[0-9]+\.clxi$/;

const readJson = (path, what) => {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new IndexArtefactError(
      'INDEX_NOT_BUILT',
      `${what} not found at ${path}; run pnpm turbo run build:index --filter=@codelex/lexicon`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new IndexArtefactError('INDEX_MANIFEST_INVALID', `${what} at ${path} is not JSON`);
  }
};

const isEntry = (e) =>
  typeof e === 'object' &&
  e !== null &&
  typeof e.id === 'string' &&
  typeof e.kind === 'string' &&
  typeof e.definitionHash === 'string' &&
  Number.isInteger(e.formatVersion) &&
  Number.isInteger(e.flags) &&
  typeof e.gaddag === 'boolean' &&
  typeof e.file === 'string' &&
  FILE.test(e.file) &&
  Number.isInteger(e.bytes) &&
  e.bytes > 0 &&
  typeof e.sha256 === 'string' &&
  HEX64.test(e.sha256);

/**
 * Reads `current.json` and the manifest it points to.
 * @param {string} [indexesDir] default {@link INDEXES_DIR}
 */
export function readIndexManifest(indexesDir = INDEXES_DIR) {
  const pointer = readJson(join(indexesDir, 'current.json'), 'current.json');
  if (
    typeof pointer !== 'object' ||
    pointer === null ||
    typeof pointer.lexiconVersion !== 'string' ||
    !VERSION.test(pointer.lexiconVersion) ||
    pointer.manifest !== `${pointer.lexiconVersion}/manifest.json`
  ) {
    throw new IndexArtefactError('INDEX_MANIFEST_INVALID', 'current.json has an unexpected shape');
  }
  const dir = join(indexesDir, pointer.lexiconVersion);
  const manifest = readJson(join(dir, 'manifest.json'), 'manifest.json');
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    manifest.lexiconVersion !== pointer.lexiconVersion ||
    !Array.isArray(manifest.profiles) ||
    !manifest.profiles.every(isEntry)
  ) {
    throw new IndexArtefactError(
      'INDEX_MANIFEST_INVALID',
      `manifest.json of ${pointer.lexiconVersion} has an unexpected shape or version`,
    );
  }
  return { lexiconVersion: manifest.lexiconVersion, dir, profiles: manifest.profiles };
}

/**
 * Locates one artefact and checks its size and sha256 against the manifest.
 * @param {{ profileId: string, flags: number }} which flags 1 = with GADDAG (server, bots), 0 = without (mobile)
 * @param {string} [indexesDir] default {@link INDEXES_DIR}
 */
export function resolveIndexArtefact({ profileId, flags }, indexesDir = INDEXES_DIR) {
  const { lexiconVersion, dir, profiles } = readIndexManifest(indexesDir);
  const entry = profiles.find((p) => p.id === profileId && p.flags === flags);
  if (entry === undefined) {
    throw new IndexArtefactError(
      'INDEX_PROFILE_MISSING',
      `no artefact for profile ${profileId} with flags ${flags} in ${lexiconVersion}`,
    );
  }
  const path = join(dir, entry.file);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new IndexArtefactError('INDEX_NOT_BUILT', `${entry.file} listed but missing in ${dir}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || sha256 !== entry.sha256) {
    throw new IndexArtefactError(
      'INDEX_SHA_MISMATCH',
      `${entry.file}: ${bytes.length} bytes, sha256 ${sha256}; manifest says ${entry.bytes} bytes, ${entry.sha256}`,
    );
  }
  return { lexiconVersion, path, entry, bytes };
}
