import { describe, expect, it } from '@jest/globals';

import {
  DEEP_LINK_FALLBACK,
  MAX_DEEP_LINK_LENGTH,
  isSafeDeepLink,
  redirectSystemPath,
} from './deep-link';

const redirect = (path: string): string => redirectSystemPath({ path, initial: false });

describe('deep-link guard (GHSA-vcc3-ghjq-m6fr)', () => {
  it.each([
    'codelex:///',
    '/',
    'codelex://match/abc-123?mode=classic&bot=beginner',
    'https://codelex.app/invite/XYZ?ref=a%20b',
    '/terms/%C3%A9t%C3%A9',
    `/${'a'.repeat(MAX_DEEP_LINK_LENGTH - 1)}`,
  ])('lets %s through unchanged', (path) => {
    expect(isSafeDeepLink(path)).toBe(true);
    expect(redirect(path)).toBe(path);
  });

  it.each([
    ['malformed percent-encoding', 'codelex:///?q=%E0%A4%A'],
    ['a lone percent sign', '/a%'],
    ['an invalid UTF-8 sequence', '/x?y=%C0%AF'],
    ['a space', '/a b'],
    ['a control character', '/a\nb'],
    ['non-ASCII text', '/été'],
    ['the empty string', ''],
    ['an over-long link', `/${'a'.repeat(MAX_DEEP_LINK_LENGTH)}`],
  ])('sends a link with %s to Home', (_label, path) => {
    expect(isSafeDeepLink(path)).toBe(false);
    expect(redirect(path)).toBe(DEEP_LINK_FALLBACK);
  });

  it('rejects the advisory-style payload: long runs of malformed percent-encoding', () => {
    const payload = `codelex:///?x=${'%E0%A4%A'.repeat(2000)}`;
    expect(redirect(payload)).toBe(DEEP_LINK_FALLBACK);
    const short = `codelex:///?x=${'%E0%A4%A'.repeat(50)}`;
    expect(short.length).toBeLessThanOrEqual(MAX_DEEP_LINK_LENGTH);
    expect(redirect(short)).toBe(DEEP_LINK_FALLBACK);
  });
});
