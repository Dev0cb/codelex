import { corpus } from '../clean-core-corpus.js';
import { idOf } from '../../core/clean-core-corpus.js';

/** Relative imports that stay inside src/core are allowed at every depth. */
export const both: unknown = [corpus, idOf];
