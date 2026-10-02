import { expect, it } from 'vitest';
import { sign } from './math.js';

it.each([
  [1, 'pos'],
  [-1, 'neg'],
  [0, 'zero'],
])('sign(%d) is %s', (n, expected) => {
  expect(sign(n)).toBe(expected);
});
