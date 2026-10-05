import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTY_BONUS,
  gameValue,
  knowledgeXp,
  letterSum,
  LETTER_VALUES,
} from '../scripts/formulas.mjs';

test('KUBERNETES reproduces the vision example (V-05): game value 43, knowledge XP 85', () => {
  assert.equal(gameValue('KUBERNETES', 'expert'), 43);
  assert.equal(knowledgeXp('KUBERNETES', 'expert'), 85);
});

test('letter table covers exactly A-Z with values 1..10', () => {
  assert.deepEqual(Object.keys(LETTER_VALUES).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  for (const v of Object.values(LETTER_VALUES)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 10);
});

test('short words get no length bonus and difficulty bonus is monotonic', () => {
  assert.equal(gameValue('TCP', 'novice'), letterSum('TCP'));
  const order = ['novice', 'intermediate', 'advanced', 'expert'].map((d) => gameValue('KAFKA', d));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
});

test('knowledge XP length component is capped at 10', () => {
  assert.equal(knowledgeXp('MOTHERBOARD', 'novice'), 20);
});

test('invalid letters are rejected', () => {
  assert.throws(() => letterSum('K8S'), RangeError);
});

test('ADR-0014 §D5 (T-6): gameValue tables are frozen lexicon constants (LEXICON_SPEC §4), independent of rules versions', () => {
  // A change here changes every gameValue and the lexiconVersion; it never follows an engine letter table.
  assert.equal(
    Object.entries(LETTER_VALUES)
      .map(([l, v]) => `${l}${v}`)
      .join(' '),
    'A1 B3 C2 D3 E1 F4 G3 H3 I1 J8 K5 L2 M3 N1 O1 P2 Q8 R1 S1 T1 U2 V6 W5 X8 Y4 Z10',
  );
  assert.deepEqual(
    { ...DIFFICULTY_BONUS },
    { novice: 0, intermediate: 4, advanced: 8, expert: 16 },
  );
  assert.ok(Object.isFrozen(LETTER_VALUES) && Object.isFrozen(DIFFICULTY_BONUS));
});
