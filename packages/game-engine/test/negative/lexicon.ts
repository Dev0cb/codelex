/**
 * A restrictive lexicon for the negative harness: built with the real `createReferenceIndex`, but only a few dozen
 * two- and three-letter forms are playable, so `not_in_lexicon` (main word and cross-word) really occurs.
 *
 * It carries the same identity (version, profile id, definition hash) as the permissive `SIM_CTX` lexicon of
 * `test/support/play.ts`, which only generates the seeded mid-game states: those states are reachable, and the
 * harness then probes them with this stricter vocabulary (the engine pins identity, not content).
 */
import {
  createReferenceIndex,
  type LexiconIndex,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import type { EngineContext } from '../../src/types.js';
import { SIM_HASH, SIM_VERSION } from '../support/play.js';

const TWO =
  'AI AD CD IP OS IO ID IT UI DB PC QA AR VR UX GO CI OR IF KB MB GB TB ML NO ON TO AT AN IN AS BE RE';
const LONGER =
  'API TCP UDP DNS CDN SQL CSS NET BIT BUG DEV OPS LOG RUN SET GET PUT TAR ZIP KEY RAM ROM CPU GPU NAT ETL GIT POD ' +
  'BOT APP WEB SSH SSL TLS GUI CLI DOS EXE ' +
  'TEST NODE CODE DATA BYTE HASH JAVA RUST LINT JSON HTTP HTML REST GRID PORT LOOP BASH PERL RUBY ENUM TYPE ' +
  'CLOUD TOKEN CACHE STACK QUEUE ROUTE PROXY REDIS LINUX ARRAY QUERY INDEX TABLE FIELD MODEL LOGIC ASYNC CLASS ' +
  'PIXEL SHELL KAFKA NGINX PYTHON DOCKER SERVER KERNEL BUCKET ROUTER SWIFT KOTLIN ' +
  'CONTAINER KUBERNETES';
const PLURALS: Readonly<Record<string, string>> = {
  POD: 'PODS',
  BUG: 'BUGS',
  KEY: 'KEYS',
  LOG: 'LOGS',
  NODE: 'NODES',
  TOKEN: 'TOKENS',
  TEST: 'TESTS',
  BYTE: 'BYTES',
  BIT: 'BITS',
  APP: 'APPS',
};
const DIFFICULTIES = ['novice', 'intermediate', 'advanced', 'expert'] as const;

export const NEGATIVE_FORMS: readonly string[] = [...TWO.split(' '), ...LONGER.split(' ')];
export const ALL_PLAYABLE: readonly string[] = [...NEGATIVE_FORMS, ...Object.values(PLURALS)];

export function negativeLexicon(): LexiconIndex {
  const terms: ReferenceTermInput[] = NEGATIVE_FORMS.map((form, i) => ({
    id: form.toLowerCase(),
    playable: true,
    form,
    difficulty: DIFFICULTIES[i % 4] ?? 'novice',
    categories: ['cloud'],
    inflections: PLURALS[form] === undefined ? [] : [{ form: PLURALS[form] ?? '', kind: 'plural' }],
    relations: [],
    gameValue: 1,
    knowledgeXp: 1,
  }));
  return createReferenceIndex({
    version: SIM_VERSION,
    profile: { id: 'global-ranked', kind: 'global', definitionHash: SIM_HASH },
    document: { terms },
  });
}

export const NEGATIVE_LEXICON = negativeLexicon();
export const NEGATIVE_CTX: EngineContext = { lexicon: NEGATIVE_LEXICON };
