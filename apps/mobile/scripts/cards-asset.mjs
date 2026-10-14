// Knowledge Card text artefact (E-1.5 slice S5, AC-13; lexicon-index note §3.6 "cards artefact"): the display-only
// content the `.clxi` does not carry (display form, EN/FR definitions, category names) for every playable term,
// written by `prepare:lexicon` next to the index as assets/lexicon/cards.json (git-ignored, reproducible).
//
// Size (mobile-app-foundation note §3.3): the JSON payload is ASCII-escaped (`\uXXXX` for non-ASCII, so Hermes stores
// one byte per character and `JSON.parse` restores the text), deflated (raw DEFLATE, RFC 1951) and base64-encoded
// into one string the JS bundle inlines. It is counted on the `bundleBytes` line: no asset or lexicon budget moves.
// The app inflates it lazily, once per process, after a match ends (src/knowledge/).
import { deflateRawSync } from 'node:zlib';

/** Asset file name (stable, so Metro can resolve the JSON import statically). */
export const CARDS_FILE = 'cards.json';
/** Envelope format; the app refuses any other value (src/knowledge/cards-data.ts). */
export const CARDS_FORMAT = 1;
export const CARDS_ENCODING = 'deflate-raw-base64';

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `\uXXXX` for every non-ASCII UTF-16 code unit (surrogate pairs become two escapes, which JSON.parse joins). */
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[^\x00-\x7f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The card payload: columns in term-id order (code units), categories in registry order. A missing locale
 * definition is `null` (the card then shows EN with a language tag; no definition at all = no card).
 * @param {{ files: { data?: { terms?: unknown[] } }[], categories: unknown[] }} lex `loadLexicon()` of @codelex/lexicon
 */
export function buildCardsPayload(lex) {
  const terms = lex.files
    .flatMap((f) => (Array.isArray(f.data?.terms) ? f.data.terms : []))
    .filter((t) => t?.playable === true)
    .sort((a, b) => byCodeUnit(a.id, b.id));
  const text = (t, locale) => {
    const value = t.definitions?.[locale];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    categories: lex.categories.map((c) => ({
      id: c.id,
      name: { en: c.name.en, fr: c.name.fr },
      icon: c.icon,
    })),
    ids: terms.map((t) => t.id),
    display: terms.map((t) => t.display),
    en: terms.map((t) => text(t, 'en')),
    fr: terms.map((t) => text(t, 'fr')),
  };
}

/**
 * The envelope the app bundles. `lexiconVersion` binds it to the `.clxi` it was built with: the app shows no card
 * when the two differ (a stale generated file), it never shows another lexicon's text.
 * @param {{ lex: object, lexiconVersion: string, cardsVersion: string }} input
 */
export function encodeCardsAsset({ lex, lexiconVersion, cardsVersion }) {
  const json = asciiJson(buildCardsPayload(lex));
  const deflated = deflateRawSync(Buffer.from(json, 'latin1'), { level: 9 });
  return {
    format: CARDS_FORMAT,
    lexiconVersion,
    cardsVersion,
    encoding: CARDS_ENCODING,
    jsonLength: json.length,
    data: deflated.toString('base64'),
  };
}

/**
 * Checks that the lexicon data matches the index being bundled, then encodes it.
 * @param {{ version: string, cardsVersion: string }} lex `loadLexicon()` result
 * @param {string} lexiconVersion the bundled index's version (descriptor)
 */
export function prepareCardsAsset(lex, lexiconVersion) {
  if (lex.version !== lexiconVersion) {
    throw new Error(
      `lexicon data is ${lex.version} but the bundled index is ${lexiconVersion}: rebuild the index ` +
        '(pnpm turbo run build:index --filter=@codelex/lexicon)',
    );
  }
  return encodeCardsAsset({ lex, lexiconVersion, cardsVersion: lex.cardsVersion });
}
