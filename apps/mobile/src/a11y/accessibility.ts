import { useEffect, useState } from 'react';
import { AccessibilityInfo, type AccessibilityChangeEventName } from 'react-native';

/** `full` or `reduced` (E-1.4 §3 rule 3). Every animation in the app has a reduced twin. */
export type MotionMode = 'full' | 'reduced';

/** An OS accessibility setting, read once and followed live. Starts from `initial` until the OS answers. */
function useOsSetting(
  read: () => Promise<boolean>,
  event: AccessibilityChangeEventName,
  initial: boolean,
): boolean {
  const [enabled, setEnabled] = useState(initial);
  useEffect(() => {
    let active = true;
    void read().then((value) => {
      if (active) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener(event, (value: boolean) => {
      setEnabled(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [read, event]);
  return enabled;
}

const isReduceMotionEnabled = (): Promise<boolean> => AccessibilityInfo.isReduceMotionEnabled();
const isScreenReaderEnabled = (): Promise<boolean> => AccessibilityInfo.isScreenReaderEnabled();

/**
 * Reduced motion follows the OS setting (E-1.5 D-22; the Settings override "Follow system / Reduce / Full" arrives
 * with the Settings screen). Starts reduced until the OS answers, so nothing animates against the player's choice.
 */
export function useMotionMode(): MotionMode {
  return useOsSetting(isReduceMotionEnabled, 'reduceMotionChanged', true) ? 'reduced' : 'full';
}

/** True while TalkBack or VoiceOver runs: the board then exposes its accessible grid (D-21). */
export function useScreenReader(): boolean {
  return useOsSetting(isScreenReaderEnabled, 'screenReaderChanged', false);
}
