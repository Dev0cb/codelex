// AC-2: schema v1 -> v2 migration keeps the playable set (and the lexiconVersion) unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateTermFileText } from '../scripts/migrate-v1-to-v2.mjs';
import { computeLexiconVersion } from '../scripts/canonical.mjs';
import { playableForms, validateLexicon } from '../scripts/validate.mjs';

const categories = [{ id: 'devops', name: { en: 'DevOps', fr: 'DevOps' } }];
const v1Text = `{
  "schemaVersion": 1,
  "category": "devops",
  "terms": [
    {
      "id": "pod",
      "form": "POD",
      "display": "Pod",
      "playable": true,
      "kind": "concept",
      "categories": ["devops"],
      "difficulty": "intermediate",
      "definitions": { "en": "Smallest deployable unit in Kubernetes.", "fr": "Plus petite unité déployable de Kubernetes." }
    },
    {
      "id": "helm-chart",
      "display": "Helm chart",
      "playable": false,
      "kind": "concept",
      "categories": ["devops"],
      "difficulty": "advanced",
      "definitions": { "en": "Package of Kubernetes manifests for Helm.", "fr": "Paquet de manifestes Kubernetes pour Helm." }
    }
  ]
}
`;

test('migration bumps schemaVersion only, preserving formatting byte for byte elsewhere', () => {
  const out = migrateTermFileText(v1Text);
  assert.equal(out, v1Text.replace('"schemaVersion": 1', '"schemaVersion": 2'));
  assert.equal(JSON.parse(out).schemaVersion, 2);
});

test('migration is idempotent and refuses unknown versions', () => {
  const once = migrateTermFileText(v1Text);
  assert.equal(migrateTermFileText(once), once);
  assert.throws(() => migrateTermFileText(v1Text.replace('"schemaVersion": 1', '"schemaVersion": 3')), /schemaVersion/);
});

test('migrated data is valid v2 with the same playable form set and the same lexiconVersion', () => {
  const v1 = { categories, blocklist: new Set(), files: [{ path: 'terms/devops.json', data: JSON.parse(v1Text) }] };
  const v2 = { categories, blocklist: new Set(), files: [{ path: 'terms/devops.json', data: JSON.parse(migrateTermFileText(v1Text)) }] };
  assert.ok(validateLexicon(v1).errors.some((e) => e.includes('schemaVersion must be 2')));
  assert.deepEqual(validateLexicon(v2).errors, []);
  assert.deepEqual(playableForms(v2), playableForms(v1));
  assert.equal(computeLexiconVersion(v2), computeLexiconVersion(v1));
});
