/**
 * Random-legal (bots-api §5.2): uniform pick among the generated PLACE_WORDs (canonical-key order, so the pick
 * does not depend on the automaton), confirmed by one `evaluateMove`; a rejected pick is dropped and redrawn
 * within `maxCandidates`. Ignores score entirely.
 */
import { evaluateMove } from '@codelex/game-engine';
import { byKey } from '../movegen/gaddag.js';
import type { PolicyInput, PolicyResult } from './types.js';

export function randomLegal(input: PolicyInput): PolicyResult {
  const { obs, engine, rng, budget } = input;
  const pool = byKey(input.candidates);
  let evaluated = 0;
  while (pool.length > 0) {
    if (evaluated >= budget.maxCandidates) {
      return { action: undefined, candidatesEvaluated: evaluated, exhausted: true };
    }
    const i = rng.int(0, pool.length);
    const [picked] = pool.splice(i, 1);
    if (picked === undefined) break;
    evaluated += 1;
    const result = evaluateMove(obs, picked.action, engine);
    if (result.ok) {
      return { action: result.value.action, candidatesEvaluated: evaluated, exhausted: false };
    }
  }
  return { action: undefined, candidatesEvaluated: evaluated, exhausted: false };
}
