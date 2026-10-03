import { describe, expect, it } from 'vitest';

import { designSystemVersion } from './index.js';

describe('designSystemVersion', () => {
  it('is a semantic version', () => {
    expect(designSystemVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
