import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameValue, knowledgeXp, letterSum, LETTER_VALUES } from '../scripts/formulas.mjs';

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
