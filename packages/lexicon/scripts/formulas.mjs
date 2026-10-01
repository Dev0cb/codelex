// Single source of truth for lexicon-derived values (docs/game/LEXICON_SPEC.md §4).
// Pure functions: used by the validator, the index build and (via re-export) the game engine.

export const LETTER_VALUES = Object.freeze({
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
});

export const DIFFICULTY_BONUS = Object.freeze({ novice: 0, intermediate: 4, advanced: 8, expert: 16 });
export const XP_BASE = Object.freeze({ novice: 10, intermediate: 25, advanced: 50, expert: 75 });

export function letterSum(form) {
  let sum = 0;
  for (const ch of form) {
    const v = LETTER_VALUES[ch];
    if (v === undefined) throw new RangeError(`invalid letter "${ch}" in form "${form}"`);
    sum += v;
  }
  return sum;
}

export function gameValue(form, difficulty) {
  return letterSum(form) + 2 * Math.max(0, form.length - 5) + DIFFICULTY_BONUS[difficulty];
}

export function knowledgeXp(form, difficulty) {
  return XP_BASE[difficulty] + Math.min(form.length, 10);
}
