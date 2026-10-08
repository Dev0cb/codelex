/**
 * The bundled Knowledge Card text, decoded once per process (E-1.5 S5). The envelope is inlined in the JS bundle
 * (Metro JSON import of the git-ignored file `prepare:lexicon` writes); decoding costs one inflate and one
 * `JSON.parse`, so it runs only when the card flag is on, after a match ends: `prewarmBundledCards` during the 600 ms
 * end-of-match hold, `bundledCards` as the synchronous fallback on the Summary.
 */
import cardsAsset from '../../assets/lexicon/cards.json';
import { decodeCardsAsset, type CardsText } from './cards-data';

let cached: { readonly version: string; readonly cards: CardsText | null } | undefined;

/** The decoded text for the bundled index of `lexiconVersion`; null when it does not decode (no card is shown). */
export function bundledCards(
  lexiconVersion: string,
  asset: unknown = cardsAsset,
): CardsText | null {
  if (cached?.version === lexiconVersion) return cached.cards;
  const decoded = decodeCardsAsset(asset, lexiconVersion);
  cached = { version: lexiconVersion, cards: decoded.ok ? decoded.value : null };
  return cached.cards;
}

/** True once {@link bundledCards} has run for this version (the Summary then reads it without decoding). */
export function bundledCardsReady(lexiconVersion: string): boolean {
  return cached?.version === lexiconVersion;
}

/** Decodes in a later task, so the frame that ends the match is not delayed. Returns a cancel function. */
export function prewarmBundledCards(lexiconVersion: string): () => void {
  if (bundledCardsReady(lexiconVersion)) return () => undefined;
  const timer = setTimeout(() => {
    bundledCards(lexiconVersion);
  }, 0);
  return () => {
    clearTimeout(timer);
  };
}

/** Test support: forget the decoded text. */
export function resetBundledCardsForTests(): void {
  cached = undefined;
}
