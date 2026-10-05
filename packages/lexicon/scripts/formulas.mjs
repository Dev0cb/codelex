// Single source of truth for lexicon-derived values (docs/game/LEXICON_SPEC.md §4).
// Pure functions: used by the validator and the index build. The game engine never reads `gameValue`.
//
// ADR-0014 §D5 (T-6): `gameValue` is a lexicon value that does not depend on any `engineRulesVersion`.
// LETTER_VALUES and DIFFICULTY_BONUS below are frozen LEXICON constants. They equal `letters-v1` and the v1 term
// bonus by history only; they do NOT follow the engine's letter tables or term bonuses (`letters-v2`, the v2
// candidates), so a rules version never changes a `gameValue` or the `lexiconVersion`. In-game numbers come from
// the engine (`rulesFor(v)`, `getLetterTable(id)`). Changing these constants changes every `gameValue` and the
// `lexiconVersion`: it needs a LEXICON_SPEC change and game-designer approval.
export const LETTER_VALUES = Object.freeze({
  A: 1,
  B: 3,
  C: 2,
  D: 3,
  E: 1,
  F: 4,
  G: 3,
  H: 3,
  I: 1,
  J: 8,
  K: 5,
  L: 2,
  M: 3,
  N: 1,
  O: 1,
  P: 2,
  Q: 8,
  R: 1,
  S: 1,
  T: 1,
  U: 2,
  V: 6,
  W: 5,
  X: 8,
  Y: 4,
  Z: 10,
});

// Lexicon constant (ADR-0014 §D5), not the in-game term bonus (GAME_RULES R-SCORE-003, per engineRulesVersion).
export const DIFFICULTY_BONUS = Object.freeze({
  novice: 0,
  intermediate: 4,
  advanced: 8,
  expert: 16,
});
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
