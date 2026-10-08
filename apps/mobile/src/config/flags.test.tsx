import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { FLAG_DEFAULTS, parseFlagOverrides, resolveFlags } from './flags';
import { FlagsProvider, useFlag } from './flags-provider';

describe('flags', () => {
  it('ship play_vs_bot.enabled off by default (E-1.5 S1, sprint 3)', () => {
    expect(FLAG_DEFAULTS['play_vs_bot.enabled']).toBe(false);
    expect(resolveFlags({})['play_vs_bot.enabled']).toBe(false);
  });

  it('ship analytics.upload.enabled off (S6a dark launch, SP2)', () => {
    expect(FLAG_DEFAULTS['analytics.upload.enabled']).toBe(false);
    expect(parseFlagOverrides('analytics.upload.enabled=1')).toEqual({
      'analytics.upload.enabled': true,
    });
  });

  it('parse build-time overrides, ignoring unknown keys and malformed values', () => {
    expect(parseFlagOverrides(undefined)).toEqual({});
    expect(parseFlagOverrides('')).toEqual({});
    expect(parseFlagOverrides('play_vs_bot.enabled=1')).toEqual({ 'play_vs_bot.enabled': true });
    expect(parseFlagOverrides(' play_vs_bot.enabled = on ')).toEqual({
      'play_vs_bot.enabled': true,
    });
    expect(parseFlagOverrides('play_vs_bot.enabled=true,play_vs_bot.enabled=off')).toEqual({
      'play_vs_bot.enabled': false,
    });
    expect(parseFlagOverrides('play_vs_bot.enabled=0')).toEqual({ 'play_vs_bot.enabled': false });
    expect(parseFlagOverrides('play_vs_bot.enabled=yes,nope=1,=1,broken')).toEqual({});
    expect(parseFlagOverrides('toString=1,__proto__=1')).toEqual({});
  });

  it('resolve overrides over the bundled defaults', () => {
    expect(resolveFlags({ 'play_vs_bot.enabled': true })).toEqual({
      ...FLAG_DEFAULTS,
      'play_vs_bot.enabled': true,
    });
  });

  it('ship the S2 defaults: live preview on (AC-5), tech squares off (AC-3)', () => {
    expect(FLAG_DEFAULTS['match.live_score_preview']).toBe(true);
    expect(FLAG_DEFAULTS['board.tech_squares.enabled']).toBe(false);
    expect(parseFlagOverrides('match.live_score_preview=0')).toEqual({
      'match.live_score_preview': false,
    });
  });
});

function Probe() {
  return (
    <>
      <Text testID="flag">{String(useFlag('play_vs_bot.enabled'))}</Text>
      <Text testID="preview">{String(useFlag('match.live_score_preview'))}</Text>
    </>
  );
}

describe('FlagsProvider', () => {
  it('serves the bundled defaults when no provider overrides them', async () => {
    await render(<Probe />);
    expect(screen.getByTestId('flag').props.children).toBe('false');
  });

  it('serves the given flags', async () => {
    await render(
      <FlagsProvider flags={{ 'play_vs_bot.enabled': true }}>
        <Probe />
      </FlagsProvider>,
    );
    expect(screen.getByTestId('flag').props.children).toBe('true');
    // Flags the caller does not name keep their bundled default.
    expect(screen.getByTestId('preview').props.children).toBe('true');
  });
});
