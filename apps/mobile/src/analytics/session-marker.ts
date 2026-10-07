/**
 * Semantics of `app_opened.previous_exit_unclean` (catalogue "App lifecycle properties"; E-1.5 OQ-SP2-4; sprint 4
 * D1). Pure decisions only: slice S6a owns the file I/O and the `AppState` subscription and must drive them through
 * these functions.
 *
 * The rule: the "session open" marker is on disk while the app is user-facing.
 * - It is **always written at launch** (the app declares no background modes, so every cold start is user-initiated).
 *   Until the app has been `active` once, only `background` removes it: iOS passes through `inactive` while it
 *   launches, and a crash at boot (a JS throw, a native crash before the first `active`) must still be reported.
 * - After the first `active`: written on every move to `active`, removed on every move to `background` or `inactive`.
 *
 * At the next cold start, a marker still on disk means the previous process ended while user-facing: a crash, an OS
 * kill or a power loss in the foreground, including during startup. An OS kill while the app is in the background (the
 * routine low-memory kill on low-end Android) or `inactive` after use (the iOS app switcher, where a swipe-away kills
 * the app) is NOT an unclean exit. Accepted blind spots: a crash while backgrounded (Play vitals cover it), and a
 * crash while `inactive` after use (notification centre, control centre, call banner).
 * Recommendation of data-analyst and mobile-engineer; the product owner's decision is pending (OQ-SP2-4).
 *
 * S6a contract:
 * 1. At process start, read the marker, call `decideAtLaunch`, write the marker (`state.present` is true).
 * 2. Subscribe with `AppState.addEventListener('change', …)` and, in the same tick, feed `AppState.currentState`
 *    through `onAppStateChange` too (a transition between the two is otherwise lost). Write or delete the file
 *    whenever `present` changes.
 * 3. Hold `previousExitUnclean` in memory and put it on the first `app_opened` of the process (the cold start), even
 *    if that comes later than the launch (the marker is consumed at launch, the event fires on the first foreground).
 *
 * Portable: no imports, so Node can reuse it (readout and tests).
 */

/**
 * The marker's file name inside the app data directory (`DATA_DIR`, `persistence/device-fs.ts`): the only directory
 * kept out of OS backups (threat model TM-03). It holds no content that matters (a single constant byte).
 */
export const SESSION_MARKER_FILE = 'session.open';

/** React Native `AppStateStatus` values (`unknown` and `extension` are iOS-only edge states). */
export type AppStateValue = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface MarkerState {
  /** The marker file is on disk. */
  readonly present: boolean;
  /** The app has been `active` at least once in this process. */
  readonly seenActive: boolean;
}

export interface LaunchDecision {
  /** The value of `app_opened.previous_exit_unclean` for this cold start. */
  readonly previousExitUnclean: boolean;
  /** The marker state to establish now: always written. */
  readonly state: MarkerState;
}

/** At a cold start, after reading whether the previous process left its marker. A first launch finds none: `false`. */
export function decideAtLaunch(markerFound: boolean): LaunchDecision {
  return { previousExitUnclean: markerFound, state: { present: true, seenActive: false } };
}

/** The marker state after `AppState` reports `next` (a change event, or the current state at subscription). */
export function onAppStateChange(state: MarkerState, next: AppStateValue): MarkerState {
  switch (next) {
    case 'active':
      return { present: true, seenActive: true };
    case 'background':
      return { present: false, seenActive: state.seenActive };
    case 'inactive':
      // During launch (never active yet) iOS reports `inactive`: keep the marker so a boot crash is counted.
      return state.seenActive ? { present: false, seenActive: true } : state;
    case 'unknown':
    case 'extension':
      return state;
  }
}
