import { describe, expect, it } from '@jest/globals';

import { APP_BUILD, buildNumber } from './build-info';

describe('buildNumber (export app.build)', () => {
  it('uses the configured build number, the prebuild default 1 when unset, 0 when malformed', () => {
    expect(buildNumber(42)).toBe('42');
    expect(buildNumber('7')).toBe('7');
    expect(buildNumber(undefined)).toBe('1');
    expect(buildNumber(null)).toBe('1');
    expect(buildNumber('1.2')).toBe('0');
    expect(buildNumber('12345678901')).toBe('0');
    expect(APP_BUILD).toMatch(/^\d{1,10}$/);
  });
});
