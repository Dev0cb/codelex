import { describe, expect, it } from 'vitest';

import { gameEngineVersion } from './index.js';

describe('gameEngineVersion', () => {
  it('is a semantic version', () => {
    expect(gameEngineVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
