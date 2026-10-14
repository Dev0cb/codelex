/**
 * The Knowledge Card text (E-1.5 slice S5, AC-13): display form, EN/FR definitions and category names, which the
 * `.clxi` index does not carry (lexicon-index note §3.6). `prepare:lexicon` writes it as a compressed envelope
 * (`scripts/cards-asset.mjs`); this module checks the envelope, inflates it and indexes it by term id. Untrusted until
 * parsed, like the index descriptor: any problem is a typed error and the Summary then shows no card (chips stay
 * inert), never an error screen.
 */
import type { Result } from '@codelex/config/result';
import type { Locale } from '@codelex/i18n';

import { decodeBase64, inflateRaw } from './inflate';

export interface CategoryText {
  readonly id: string;
  readonly name: Readonly<Record<Locale, string>>;
  /** Registry icon name (`categories.json` `icon`). */
  readonly icon: string;
}

export interface TermText {
  readonly display: string;
  /** `null` = no definition in that locale (the card falls back to EN with a tag). */
  readonly definitions: Readonly<Record<Locale, string | null>>;
}

export interface CardsText {
  readonly cardsVersion: string;
  /** Number of terms with text. */
  readonly size: number;
  term(id: string): TermText | undefined;
  category(id: string): CategoryText | undefined;
}

/**
 * `CARDS_MISSING`: no usable envelope (absent, unknown format or encoding); `CARDS_VERSION_MISMATCH`: built for
 * another lexicon version than the bundled index; `CARDS_CORRUPT`: the data does not decode to a valid payload.
 */
export type CardsErrorCode = 'CARDS_MISSING' | 'CARDS_VERSION_MISMATCH' | 'CARDS_CORRUPT';

export interface CardsError {
  readonly code: CardsErrorCode;
  /** Developer diagnostics only; never shown to the player. */
  readonly message: string;
}

const HEX16 = /^[0-9a-f]{16}$/;

// Hand-written checks rather than zod: the app bundle carries no zod today (`zod/mini` alone costs about 0.5 MB of
// Hermes bytecode with its locale tables, measured in S5), and the shapes here are small.
type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isHex16 = (value: unknown): value is string => typeof value === 'string' && HEX16.test(value);
const textArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isText);
const nullableTextArray = (value: unknown): value is readonly (string | null)[] =>
  Array.isArray(value) && value.every((v) => v === null || isText(v));

interface Envelope {
  readonly lexiconVersion: string;
  readonly cardsVersion: string;
  readonly jsonLength: number;
  readonly data: string;
}

function parseEnvelope(value: unknown): Envelope | undefined {
  if (!isRecord(value)) return undefined;
  const { format, lexiconVersion, cardsVersion, encoding, jsonLength, data } = value;
  if (
    format !== 1 ||
    encoding !== 'deflate-raw-base64' ||
    !isHex16(lexiconVersion) ||
    !isHex16(cardsVersion) ||
    typeof jsonLength !== 'number' ||
    !Number.isInteger(jsonLength) ||
    jsonLength <= 0 ||
    typeof data !== 'string'
  ) {
    return undefined;
  }
  return { lexiconVersion, cardsVersion, jsonLength, data };
}

interface Payload {
  readonly categories: readonly CategoryText[];
  readonly ids: readonly string[];
  readonly display: readonly string[];
  readonly en: readonly (string | null)[];
  readonly fr: readonly (string | null)[];
}

function parseCategory(value: unknown): CategoryText | undefined {
  if (!isRecord(value) || !isText(value.id) || !isText(value.icon) || !isRecord(value.name)) {
    return undefined;
  }
  const { en, fr } = value.name;
  return isText(en) && isText(fr)
    ? { id: value.id, name: { en, fr }, icon: value.icon }
    : undefined;
}

function parsePayload(value: unknown): Payload | undefined {
  if (!isRecord(value)) return undefined;
  const { categories, ids, display, en, fr } = value;
  if (
    !Array.isArray(categories) ||
    !textArray(ids) ||
    !textArray(display) ||
    !nullableTextArray(en) ||
    !nullableTextArray(fr) ||
    display.length !== ids.length ||
    en.length !== ids.length ||
    fr.length !== ids.length ||
    new Set(ids).size !== ids.length
  ) {
    return undefined;
  }
  const parsed = categories.map(parseCategory);
  if (parsed.some((c) => c === undefined)) return undefined;
  return {
    categories: parsed.filter((c): c is CategoryText => c !== undefined),
    ids,
    display,
    en,
    fr,
  };
}

const fail = (code: CardsErrorCode, message: string): Result<CardsText, CardsError> => ({
  ok: false,
  error: { code, message },
});

const describe = (error: unknown): string => (error instanceof Error ? error.message : 'unknown');

/** Latin-1 bytes to a string; the payload is ASCII (non-ASCII is `\uXXXX`-escaped by the generator). */
function asciiText(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/**
 * Decodes the bundled envelope for the index of `lexiconVersion`. Never throws. Cost: one inflate and one
 * `JSON.parse` of about 290 KB, so callers decode once per process and off the first frame (`bundled-cards.ts`).
 */
export function decodeCardsAsset(
  asset: unknown,
  lexiconVersion: string,
): Result<CardsText, CardsError> {
  const envelope = parseEnvelope(asset);
  if (envelope === undefined)
    return fail('CARDS_MISSING', 'cards envelope is missing or malformed');
  const { cardsVersion, data, jsonLength } = envelope;
  if (envelope.lexiconVersion !== lexiconVersion) {
    return fail(
      'CARDS_VERSION_MISMATCH',
      `cards built for ${envelope.lexiconVersion}, index is ${lexiconVersion}`,
    );
  }
  let json: unknown;
  try {
    const bytes = inflateRaw(decodeBase64(data), jsonLength);
    if (bytes.length !== jsonLength) {
      return fail(
        'CARDS_CORRUPT',
        `inflated ${String(bytes.length)} B, expected ${String(jsonLength)} B`,
      );
    }
    json = JSON.parse(asciiText(bytes));
  } catch (error) {
    return fail('CARDS_CORRUPT', `cards data does not decode: ${describe(error)}`);
  }
  const payload = parsePayload(json);
  if (payload === undefined) return fail('CARDS_CORRUPT', 'cards payload is malformed');
  const { ids, display, en, fr, categories } = payload;
  const terms = new Map<string, TermText>();
  ids.forEach((id, i) => {
    terms.set(id, {
      display: display[i] ?? id,
      definitions: { en: en[i] ?? null, fr: fr[i] ?? null },
    });
  });
  const byCategory = new Map(categories.map((c) => [c.id, c] as const));
  return {
    ok: true,
    value: {
      cardsVersion,
      size: terms.size,
      term: (id) => terms.get(id),
      category: (id) => byCategory.get(id),
    },
  };
}
