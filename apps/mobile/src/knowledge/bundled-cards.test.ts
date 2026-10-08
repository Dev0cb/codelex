import { afterEach, describe, expect, it, jest } from '@jest/globals';

import descriptor from '../../assets/lexicon/lexicon.json';
import {
  bundledCards,
  bundledCardsReady,
  prewarmBundledCards,
  resetBundledCardsForTests,
} from './bundled-cards';

const VERSION = descriptor.lexiconVersion;

afterEach(() => {
  resetBundledCardsForTests();
  jest.useRealTimers();
});

describe('bundled card text (decoded once per process)', () => {
  it('decodes on the first call and reuses the result', () => {
    expect(bundledCardsReady(VERSION)).toBe(false);
    const first = bundledCards(VERSION);
    expect(first?.term('kubernetes')?.display).toBe('Kubernetes');
    expect(bundledCardsReady(VERSION)).toBe(true);
    expect(bundledCards(VERSION)).toBe(first);
  });

  it('is null (no card shown) for another index version, and remembers that', () => {
    expect(bundledCards('aaaaaaaaaaaaaaaa')).toBeNull();
    expect(bundledCardsReady('aaaaaaaaaaaaaaaa')).toBe(true);
    expect(bundledCards('aaaaaaaaaaaaaaaa')).toBeNull();
  });

  it('prewarms in a later task, which can be cancelled', () => {
    jest.useFakeTimers();
    const cancel = prewarmBundledCards(VERSION);
    expect(bundledCardsReady(VERSION)).toBe(false);
    cancel();
    jest.runAllTimers();
    expect(bundledCardsReady(VERSION)).toBe(false);
    prewarmBundledCards(VERSION);
    jest.runAllTimers();
    expect(bundledCardsReady(VERSION)).toBe(true);
    // Already decoded: nothing is scheduled.
    const noop = prewarmBundledCards(VERSION);
    noop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
