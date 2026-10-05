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
    expect(resolveFlags({ 'play_vs_bot.enabled': true })).toEqual({ 'play_vs_bot.enabled': true });
  });
});

function Probe() {
  return <Text testID="flag">{String(useFlag('play_vs_bot.enabled'))}</Text>;
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
  });
});
