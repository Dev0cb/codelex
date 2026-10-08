import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from '@jest/globals';

import bundled from '../../assets/lexicon/cards.json';
import descriptor from '../../assets/lexicon/lexicon.json';
import { decodeCardsAsset } from './cards-data';

const VERSION = '0123456789abcdef';

/** Encodes a payload the way scripts/cards-asset.mjs does (ASCII JSON, raw DEFLATE, base64). */
function envelope(payload: unknown, overrides: Record<string, unknown> = {}): unknown {
  const json = JSON.stringify(payload).replace(
    /[^\x00-\x7f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return {
    format: 1,
    lexiconVersion: VERSION,
    cardsVersion: 'fedcba9876543210',
    encoding: 'deflate-raw-base64',
    jsonLength: json.length,
    data: deflateRawSync(Buffer.from(json, 'latin1')).toString('base64'),
    ...overrides,
  };
}

const PAYLOAD = {
  categories: [{ id: 'cloud', name: { en: 'Cloud', fr: 'Nuage' }, icon: 'cloud' }],
  ids: ['api', 'pod'],
  display: ['API', 'Pod'],
  en: ['Application interface.', null],
  fr: [null, 'Groupe de conteneurs, unité de déploiement.'],
};

describe('decodeCardsAsset', () => {
  it('decodes term text and category names, non-ASCII included', () => {
    const result = decodeCardsAsset(envelope(PAYLOAD), VERSION);
    if (!result.ok) throw new Error(result.error.message);
    const cards = result.value;
    expect(cards.size).toBe(2);
    expect(cards.cardsVersion).toBe('fedcba9876543210');
    expect(cards.term('api')).toEqual({
      display: 'API',
      definitions: { en: 'Application interface.', fr: null },
    });
    expect(cards.term('pod')?.definitions.fr).toBe('Groupe de conteneurs, unité de déploiement.');
    expect(cards.term('nope')).toBeUndefined();
    expect(cards.term('__proto__')).toBeUndefined();
    expect(cards.category('cloud')).toEqual({
      id: 'cloud',
      name: { en: 'Cloud', fr: 'Nuage' },
      icon: 'cloud',
    });
    expect(cards.category('nope')).toBeUndefined();
  });

  it('refuses another lexicon version (a stale generated file never shows foreign text)', () => {
    const result = decodeCardsAsset(envelope(PAYLOAD), 'aaaaaaaaaaaaaaaa');
    expect(result).toMatchObject({ ok: false, error: { code: 'CARDS_VERSION_MISMATCH' } });
  });

  it.each([
    ['not an object', 'x', 'CARDS_MISSING'],
    ['a fractional jsonLength', envelope(PAYLOAD, { jsonLength: 1.5 }), 'CARDS_MISSING'],
    ['a negative jsonLength', envelope(PAYLOAD, { jsonLength: -1 }), 'CARDS_MISSING'],
    ['a non-numeric jsonLength', envelope(PAYLOAD, { jsonLength: '9' }), 'CARDS_MISSING'],
    ['a missing data string', envelope(PAYLOAD, { data: 7 }), 'CARDS_MISSING'],
    ['a bad lexiconVersion', envelope(PAYLOAD, { lexiconVersion: 'nope' }), 'CARDS_MISSING'],
    ['an empty id', envelope({ ...PAYLOAD, ids: ['', 'pod'] }), 'CARDS_CORRUPT'],
    ['a non-string display', envelope({ ...PAYLOAD, display: ['API', 3] }), 'CARDS_CORRUPT'],
    ['an empty definition', envelope({ ...PAYLOAD, en: ['', null] }), 'CARDS_CORRUPT'],
    ['a non-string definition', envelope({ ...PAYLOAD, fr: [null, 5] }), 'CARDS_CORRUPT'],
    ['a short EN column', envelope({ ...PAYLOAD, en: ['x'] }), 'CARDS_CORRUPT'],
    ['a short FR column', envelope({ ...PAYLOAD, fr: [null] }), 'CARDS_CORRUPT'],
    [
      'a category that is not an object',
      envelope({ ...PAYLOAD, categories: ['x'] }),
      'CARDS_CORRUPT',
    ],
    [
      'a category with an empty icon',
      envelope({ ...PAYLOAD, categories: [{ id: 'x', icon: '', name: { en: 'X', fr: 'X' } }] }),
      'CARDS_CORRUPT',
    ],
    ['an unknown format', envelope(PAYLOAD, { format: 2 }), 'CARDS_MISSING'],
    ['an unknown encoding', envelope(PAYLOAD, { encoding: 'gzip' }), 'CARDS_MISSING'],
    ['bad base64', envelope(PAYLOAD, { data: '***' }), 'CARDS_CORRUPT'],
    ['a length mismatch', envelope(PAYLOAD, { jsonLength: 3 }), 'CARDS_CORRUPT'],
    ['columns of different lengths', envelope({ ...PAYLOAD, display: ['API'] }), 'CARDS_CORRUPT'],
    ['a malformed payload', envelope({ ids: 'x' }), 'CARDS_CORRUPT'],
    ['duplicate ids', envelope({ ...PAYLOAD, ids: ['api', 'api'] }), 'CARDS_CORRUPT'],
    ['a malformed category', envelope({ ...PAYLOAD, categories: [{ id: 'x' }] }), 'CARDS_CORRUPT'],
    [
      'a category without names',
      envelope({ ...PAYLOAD, categories: [{ id: 'x', icon: 'y', name: { en: 'X' } }] }),
      'CARDS_CORRUPT',
    ],
    ['categories that are not a list', envelope({ ...PAYLOAD, categories: {} }), 'CARDS_CORRUPT'],
    ['a payload that is not an object', envelope([1]), 'CARDS_CORRUPT'],
    ['a bad cardsVersion', envelope(PAYLOAD, { cardsVersion: 'X' }), 'CARDS_MISSING'],
  ])('reports %s as a typed error, never throws', (_, asset, code) => {
    expect(decodeCardsAsset(asset, VERSION)).toMatchObject({ ok: false, error: { code } });
  });

  it('reports data shorter than announced as corrupt', () => {
    const asset = envelope(PAYLOAD) as Record<string, number>;
    const longer = { ...asset, jsonLength: (asset.jsonLength ?? 0) + 5 };
    expect(decodeCardsAsset(longer, VERSION)).toMatchObject({
      ok: false,
      error: { code: 'CARDS_CORRUPT' },
    });
  });

  it('reports JSON that does not parse as corrupt', () => {
    const json = '{"ids":';
    const asset = {
      ...(envelope(PAYLOAD) as Record<string, unknown>),
      jsonLength: json.length,
      data: deflateRawSync(Buffer.from(json)).toString('base64'),
    };
    expect(decodeCardsAsset(asset, VERSION)).toMatchObject({
      ok: false,
      error: { code: 'CARDS_CORRUPT' },
    });
  });

  it('decodes the bundled asset for the bundled index', () => {
    const result = decodeCardsAsset(bundled, descriptor.lexiconVersion);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.size).toBeGreaterThan(1000);
    expect(result.value.term('kubernetes')?.display).toBe('Kubernetes');
    expect(result.value.category('cloud')?.name.fr).toBe('Cloud');
  });
});
