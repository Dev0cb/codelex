import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Text,
  type AccessibilityChangeEventName,
  type EmitterSubscription,
} from 'react-native';

import { useMotionMode, useScreenReader } from './accessibility';

type Listener = (enabled: boolean) => void;

function captureListeners(): Map<AccessibilityChangeEventName, Listener> {
  const listeners = new Map<AccessibilityChangeEventName, Listener>();
  const subscribe = (event: AccessibilityChangeEventName, handler: Listener) => {
    listeners.set(event, handler);
    return { remove: () => listeners.delete(event) } as unknown as EmitterSubscription;
  };
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation(subscribe as unknown as typeof AccessibilityInfo.addEventListener);
  return listeners;
}

function Probe() {
  return (
    <>
      <Text testID="motion">{useMotionMode()}</Text>
      <Text testID="reader">{String(useScreenReader())}</Text>
    </>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('accessibility hooks', () => {
  it('follow the OS reduce-motion and screen-reader settings, and their live changes (D-22, D-21)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const listeners = captureListeners();
    const { unmount } = await render(<Probe />);
    expect(screen.getByTestId('motion').props.children).toBe('reduced');
    expect(screen.getByTestId('reader').props.children).toBe('false');
    await act(async () => {
      listeners.get('reduceMotionChanged')?.(false);
      listeners.get('screenReaderChanged')?.(true);
      await Promise.resolve();
    });
    expect(screen.getByTestId('motion').props.children).toBe('full');
    expect(screen.getByTestId('reader').props.children).toBe('true');
    await unmount();
    expect(listeners.size).toBe(0);
  });

  it('default to full motion and no screen reader', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    await render(<Probe />);
    expect(screen.getByTestId('motion').props.children).toBe('full');
    expect(screen.getByTestId('reader').props.children).toBe('false');
  });
});
