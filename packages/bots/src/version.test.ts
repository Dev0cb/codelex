import { describe, expect, it } from 'vitest';

import { botsVersion } from './index.js';

describe('botsVersion', () => {
  it('is a semantic version', () => {
    expect(botsVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
