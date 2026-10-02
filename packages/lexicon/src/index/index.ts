export type * from './types.js';
export {
  DIFFICULTIES,
  FORM_KINDS,
  GADDAG_SEPARATOR,
  INFLECTION_KINDS,
  LETTER_COUNT,
  MAX_FORM_LENGTH,
  RELATION_TYPES,
  hasRelation,
  isDefinitionHash,
  isLexiconVersion,
  relationBit,
  relationTypesOf,
} from './constants.js';
export {
  CLXI_MAGIC,
  SUPPORTED_FORMAT_VERSIONS,
  decodeLexiconIndex,
  type DecodeLexiconIndex,
} from './decode.js';
export {
  REFERENCE_FORMAT_VERSION,
  createReferenceIndex,
  type ReferenceIndexInput,
  type ReferenceTermInput,
} from './reference.js';
