import { ok, type Result } from '@codelex/config/result';
import type { Rng } from '@codelex/game-engine';

export function first(rng: Rng): Result<number, never> {
  return ok(rng.next());
}
