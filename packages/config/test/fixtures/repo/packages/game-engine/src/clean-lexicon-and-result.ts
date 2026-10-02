import { ok, type Ok } from '@codelex/config/result';
import type { TermId } from '@codelex/lexicon';

export function wrap(id: TermId): Ok<TermId> {
  return ok(id);
}
