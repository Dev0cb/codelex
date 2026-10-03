import { Asset } from 'expo-asset';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';

// Both files are written by `prepare:lexicon` (scripts/prepare-lexicon.mjs) and git-ignored; stable names so Metro
// can resolve them statically. The descriptor is inlined in the JS bundle, the `.clxi` ships as a binary asset.
import lexiconAsset from '../../assets/lexicon/lexicon.clxi';
import lexiconDescriptor from '../../assets/lexicon/lexicon.json';
import { toHex, type LexiconSource } from './load-lexicon';

/** Asset module id (Metro `require`) or URI of the bundled `.clxi`. */
export type AssetModule = number | string;

/**
 * Device implementation of {@link LexiconSource} (mobile-app-foundation note §3.2): expo-asset resolves the
 * embedded file (`downloadAsync` is a no-op for embedded assets in release builds), expo-file-system reads it into
 * a fresh `Uint8Array` (aligned, so the decoder makes zero-copy views), expo-crypto hashes it natively.
 */
export function createBundledLexiconSource(
  assetModule: AssetModule = lexiconAsset,
  descriptor: unknown = lexiconDescriptor,
): LexiconSource {
  return {
    descriptor,
    async readBytes() {
      const asset = await Asset.fromModule(assetModule).downloadAsync();
      const uri = asset.localUri;
      if (uri === null) throw new Error('lexicon asset has no local file');
      return new File(uri).bytes();
    },
    async sha256Hex(bytes) {
      return toHex(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)));
    },
  };
}
