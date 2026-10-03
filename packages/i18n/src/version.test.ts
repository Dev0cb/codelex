import { describe, expect, it } from 'vitest';

import { i18nVersion } from './index.js';

describe('i18nVersion', () => {
  it('is a semantic version', () => {
    expect(i18nVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
