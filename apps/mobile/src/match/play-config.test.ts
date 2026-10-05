import { createMatch, getLayout, getLetterTable, rulesFor } from '@codelex/game-engine';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import type { LoadedLexicon } from '../lexicon/load-lexicon';
import {
  BOT_SEAT,
  HUMAN_SEAT,
  PLAY_BOT,
  PLAY_LAYOUT,
  PLAY_LETTERS,
  PLAY_RULES_VERSION,
  THINK_DELAY_MS,
  playMatchConfig,
  seedFromBytes,
  thinkDelayMs,
} from './play-config';
import { loadBundledLexicon, seedOf } from './test-support';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

describe('play configuration (E-1.5 AC-3)', () => {
  it('pins rules version 1, a frozen registry version (never a draft)', () => {
    expect(PLAY_RULES_VERSION).toBe(1);
    expect(rulesFor(PLAY_RULES_VERSION).status).toBe('frozen');
  });

  it('uses the layout and letter table of the pinned version: classic-v1 with the DW start, 100 tiles', () => {
    const set = rulesFor(PLAY_RULES_VERSION);
    expect(set.layouts).toContain(PLAY_LAYOUT);
    expect(set.letterTables).toContain(PLAY_LETTERS);
    const layout = getLayout(PLAY_LAYOUT);
    expect(layout.squares[layout.start.row * layout.size + layout.start.col]).toBe('DW');
    const letters = getLetterTable(PLAY_LETTERS);
    expect(letters.counts.reduce((a, b) => a + b, 0) + letters.blanks).toBe(100);
  });

  it('builds an untimed-vs-bot 1v1 header pinned to the bundled lexicon', () => {
    const config = playMatchConfig(seedOf(7), lexicon.index);
    expect(config).toEqual({
      seed: '0000000000000007',
      engineRulesVersion: 1,
      lexiconVersion: lexicon.descriptor.lexiconVersion,
      profileId: lexicon.descriptor.profileId,
      definitionHash: lexicon.index.profile.definitionHash,
      config: {
        mode: 'classic',
        format: 'untimed-vs-bot',
        seats: 2,
        teams: [[HUMAN_SEAT], [BOT_SEAT]],
        layout: 'classic-v1',
        letters: 'letters-v1',
        requireWinner: 0,
      },
    });
    const created = createMatch(config, { lexicon: lexicon.index });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.state.seats.map((s) => s.rack.length)).toEqual([7, 7]);
    expect(created.value.state.bag).toHaveLength(86);
  });

  it('plays Beginner in S1', () => {
    expect(PLAY_BOT).toBe('beginner');
  });

  it('turns 8 random bytes into a 64-bit hex seed', () => {
    expect(seedFromBytes(new Uint8Array([0, 1, 2, 3, 0xab, 0xcd, 0xef, 0xff]))).toBe(
      '00010203abcdefff',
    );
    expect(() => seedFromBytes(new Uint8Array(7))).toThrow(RangeError);
  });

  it('draws the presentation delay inside the think-delay range', () => {
    expect(thinkDelayMs(() => 0)).toBe(THINK_DELAY_MS.min);
    expect(thinkDelayMs(() => 0.5)).toBe(2600);
    expect(thinkDelayMs(() => 1)).toBe(THINK_DELAY_MS.max);
    expect(thinkDelayMs(() => -3)).toBe(THINK_DELAY_MS.min);
  });
});
