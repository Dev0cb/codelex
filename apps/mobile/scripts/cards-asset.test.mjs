import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { loadLexicon } from '@codelex/lexicon/validate';

import {
  CARDS_ENCODING,
  CARDS_FORMAT,
  asciiJson,
  buildCardsPayload,
  encodeCardsAsset,
  prepareCardsAsset,
} from './cards-asset.mjs';

const term = (id, extra = {}) => ({
  id,
  display: id.toUpperCase(),
  playable: true,
  definitions: { en: `${id} in English.`, fr: `${id} en français.` },
  ...extra,
});
const LEX = {
  version: '0123456789abcdef',
  cardsVersion: 'fedcba9876543210',
  categories: [{ id: 'cloud', name: { en: 'Cloud', fr: 'Cloud' }, icon: 'cloud', colorToken: 'x' }],
  files: [
    { data: { terms: [term('pod'), term('hidden', { playable: false })] } },
    { data: { terms: [term('api', { definitions: { en: 'Application interface.' } })] } },
    { data: {} },
  ],
};

const decode = (asset) =>
  JSON.parse(inflateRawSync(Buffer.from(asset.data, 'base64')).toString('latin1'));

test('the payload holds playable terms only, in id order, with null for a missing locale', () => {
  assert.deepEqual(buildCardsPayload(LEX), {
    categories: [{ id: 'cloud', name: { en: 'Cloud', fr: 'Cloud' }, icon: 'cloud' }],
    ids: ['api', 'pod'],
    display: ['API', 'POD'],
    en: ['Application interface.', 'pod in English.'],
    fr: [null, 'pod en français.'],
  });
});

test('ASCII JSON escapes every non-ASCII code unit and parses back to the same text', () => {
  const value = { fr: 'Définition à côté — “ok” 🙂' };
  const json = asciiJson(value);
  assert.match(json, /^[\x00-\x7f]*$/);
  assert.deepEqual(JSON.parse(json), value);
});

test('the envelope is versioned and inflates back to the payload', () => {
  const asset = encodeCardsAsset({ lex: LEX, lexiconVersion: LEX.version, cardsVersion: 'c' });
  assert.equal(asset.format, CARDS_FORMAT);
  assert.equal(asset.encoding, CARDS_ENCODING);
  assert.equal(asset.lexiconVersion, LEX.version);
  assert.equal(asset.cardsVersion, 'c');
  assert.match(asset.data, /^[A-Za-z0-9+/]*={0,2}$/);
  assert.deepEqual(decode(asset), buildCardsPayload(LEX));
  assert.equal(asset.jsonLength, asciiJson(buildCardsPayload(LEX)).length);
});

test('prepare refuses data that is not the bundled index version', () => {
  assert.throws(() => prepareCardsAsset(LEX, 'aaaaaaaaaaaaaaaa'), /rebuild the index/);
  assert.equal(prepareCardsAsset(LEX, LEX.version).cardsVersion, LEX.cardsVersion);
});

test('the real lexicon: every playable term has a card, within the size this slice measured', () => {
  const lex = loadLexicon();
  const asset = prepareCardsAsset(lex, lex.version);
  const payload = decode(asset);
  assert.equal(payload.ids.length, payload.display.length);
  assert.equal(payload.ids.length, payload.en.length);
  assert.equal(payload.ids.length, payload.fr.length);
  assert.ok(payload.en.every((d) => typeof d === 'string' && d.length <= 160));
  // ≈ 126 KB of base64 for 1,432 terms (sprint 4 S5); a jump means the format or the corpus changed: re-measure the
  // bundle (mobile-app-foundation note §3.3) before raising this.
  assert.ok(asset.data.length < 100 * payload.ids.length, `${asset.data.length} B of base64`);
});
