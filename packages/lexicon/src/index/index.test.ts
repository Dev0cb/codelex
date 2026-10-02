import { describe, expect, it } from 'vitest';

import * as lexiconIndex from './index.js';

describe('@codelex/lexicon/index public API', () => {
  it('exports exactly the runtime values of the contract', () => {
    expect(Object.keys(lexiconIndex).sort()).toEqual([
      'CLXI_MAGIC',
      'DIFFICULTIES',
      'FORM_KINDS',
      'GADDAG_SEPARATOR',
      'INFLECTION_KINDS',
      'LETTER_COUNT',
      'MAX_FORM_LENGTH',
      'RELATION_TYPES',
      'SUPPORTED_FORMAT_VERSIONS',
      'decodeLexiconIndex',
      'hasRelation',
      'isLexiconVersion',
      'relationBit',
      'relationTypesOf',
    ]);
  });
});
