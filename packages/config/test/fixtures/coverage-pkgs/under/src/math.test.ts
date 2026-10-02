import { expect, it } from 'vitest';
import { sign } from './math.js';

it('sign of a positive number', () => {
  expect(sign(1)).toBe('pos');
});
