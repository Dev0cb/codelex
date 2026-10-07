/**
 * Semantics of `app_opened.previous_exit_unclean` (catalogue "App lifecycle properties"; E-1.5 OQ-SP2-4; sprint 4
 * D1). Pure decisions only: slice S6a owns the file I/O and the `AppState` subscription and must drive them through
 * these functions.
 *
 * The rule: the "session open" marker is on disk exactly while the app is `active` (in the foreground and
 * interactive). It is written at launch and on every move to `active`, and removed on every move to `background` or
 * `inactive`. At the next cold start, a marker still on disk means the previous process ended while active: a crash,
 * an OS kill or a power loss in the foreground. An OS kill while the app is in the background (the routine
 * low-memory kill on low-end Android) or `inactive` (the iOS app switcher, where a swipe-away kills the app) is NOT an
 * unclean exit. A crash while backgrounded is not counted either (accepted blind spot; Play vitals cover it).
 * Recommendation of data-analyst and mobile-engineer; the product owner's decision is pending (OQ-SP2-4).
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

export type MarkerAction = 'write' | 'clear' | 'keep';

/** What to do with the marker when `AppState` changes to `next`. */
export function markerActionOnChange(next: AppStateValue): MarkerAction {
  switch (next) {
    case 'active':
      return 'write';
    case 'background':
    case 'inactive':
      return 'clear';
    case 'unknown':
    case 'extension':
      return 'keep';
  }
}

export interface LaunchDecision {
  /** The value of `app_opened.previous_exit_unclean` for this cold start. */
  readonly previousExitUnclean: boolean;
  /** What to do with the marker once it has been read. */
  readonly action: Exclude<MarkerAction, 'keep'>;
}

/**
 * At a cold start, after reading whether the previous process left its marker. The marker then reflects this
 * process: written unless the app starts in the background or `inactive` (a stale marker is never kept). A first
 * launch finds no marker, hence `false`.
 */
export function decideAtLaunch(markerFound: boolean, initial: AppStateValue): LaunchDecision {
  const now = markerActionOnChange(initial);
  return { previousExitUnclean: markerFound, action: now === 'clear' ? 'clear' : 'write' };
}

/** The marker after applying `action` to a marker that was `present`. */
export function applyMarkerAction(present: boolean, action: MarkerAction): boolean {
  if (action === 'write') return true;
  if (action === 'clear') return false;
  return present;
}
