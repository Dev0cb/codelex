// Type declarations for scripts/indexes.mjs (`@codelex/lexicon/indexes`, sprint L6).

/** One artefact of `dist/indexes/<lexiconVersion>/manifest.json`. */
export interface IndexManifestEntry {
  readonly id: string;
  readonly kind: string;
  readonly definitionHash: string;
  readonly formatVersion: number;
  /** Header flags: 1 = GADDAG section present (server, bots), 0 = DAWG only (mobile). */
  readonly flags: number;
  readonly gaddag: boolean;
  /** `<profileId>.f<flags>.clxi`, relative to the version directory. */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type IndexArtefactErrorCode =
  'INDEX_NOT_BUILT' | 'INDEX_MANIFEST_INVALID' | 'INDEX_PROFILE_MISSING' | 'INDEX_SHA_MISMATCH';

export class IndexArtefactError extends Error {
  readonly code: IndexArtefactErrorCode;
  constructor(code: IndexArtefactErrorCode, message: string);
}

/** Absolute path of `packages/lexicon/dist/indexes`. */
export const INDEXES_DIR: string;

export function readIndexManifest(indexesDir?: string): {
  readonly lexiconVersion: string;
  /** Absolute path of `dist/indexes/<lexiconVersion>`. */
  readonly dir: string;
  readonly profiles: readonly IndexManifestEntry[];
};

/** Throws {@link IndexArtefactError} when absent or when size or sha256 differ from the manifest. */
export function resolveIndexArtefact(
  which: { readonly profileId: string; readonly flags: number },
  indexesDir?: string,
): {
  readonly lexiconVersion: string;
  readonly path: string;
  readonly entry: IndexManifestEntry;
  readonly bytes: Buffer;
};
