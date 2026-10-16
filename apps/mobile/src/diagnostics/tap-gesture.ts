/**
 * The hidden entry gesture (DG1 note §4): 7 taps on the versions row, each within 1 s of the previous; a longer
 * gap restarts the count. No toast, no countdown, no haptic. Lives in the diagnostics module, so production builds
 * contain neither the gesture nor its handler.
 */

export const ENTRY_TAPS = 7;
export const ENTRY_WINDOW_MS = 1000;

/** `tap()` returns true on the tap that completes the sequence (the count then restarts). */
export function createTapCounter(
  now: () => number,
  taps: number = ENTRY_TAPS,
  windowMs: number = ENTRY_WINDOW_MS,
): { tap(): boolean } {
  let count = 0;
  let last = Number.NEGATIVE_INFINITY;
  return {
    tap() {
      const at = now();
      count = at - last <= windowMs ? count + 1 : 1;
      last = at;
      if (count < taps) return false;
      count = 0;
      last = Number.NEGATIVE_INFINITY;
      return true;
    },
  };
}
