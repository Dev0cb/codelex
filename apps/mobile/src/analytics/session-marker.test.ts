/**
 * `previous_exit_unclean` semantics (OQ-SP2-4, sprint 4 D1): a process that dies while the app is active is an
 * unclean exit; one that dies in the background or `inactive` (OS low-memory kill, swipe-away) is not.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  applyMarkerAction,
  decideAtLaunch,
  markerActionOnChange,
  SESSION_MARKER_FILE,
  type AppStateValue,
} from './session-marker.ts';

const STATES: readonly AppStateValue[] = [
  'active',
  'background',
  'inactive',
  'unknown',
  'extension',
];

/**
 * One process: it launches in `initial`, goes through `changes`, then dies (crash or kill). Returns whether the marker
 * is on disk afterwards, i.e. what the next cold start reads.
 */
function markerAfterDeath(
  markerBefore: boolean,
  initial: AppStateValue,
  changes: readonly AppStateValue[],
): { readonly reported: boolean; readonly markerOnDisk: boolean } {
  const launch = decideAtLaunch(markerBefore, initial);
  let marker = applyMarkerAction(markerBefore, launch.action);
  for (const next of changes) marker = applyMarkerAction(marker, markerActionOnChange(next));
  return { reported: launch.previousExitUnclean, markerOnDisk: marker };
}

/** The last state that moved the marker: launch counts as foreground unless it starts in background/inactive. */
function lastDecisiveState(
  initial: AppStateValue,
  changes: readonly AppStateValue[],
): AppStateValue {
  const decisive = [initial, ...changes].filter((s) => s !== 'unknown' && s !== 'extension');
  return decisive.at(-1) ?? 'active';
}

describe('session marker (previous_exit_unclean)', () => {
  it('lives in the backup-excluded data directory under a fixed name', () => {
    expect(SESSION_MARKER_FILE).toBe('session.open');
  });

  it('reports false on a first launch (no marker on disk)', () => {
    expect(decideAtLaunch(false, 'active')).toEqual({
      previousExitUnclean: false,
      action: 'write',
    });
  });

  it('counts a crash or kill while active as unclean', () => {
    expect(markerAfterDeath(false, 'active', []).markerOnDisk).toBe(true);
    expect(markerAfterDeath(false, 'active', ['background', 'active']).markerOnDisk).toBe(true);
  });

  it('does not count an OS kill in the background (low-memory kill) as unclean', () => {
    expect(markerAfterDeath(false, 'active', ['background']).markerOnDisk).toBe(false);
  });

  it('does not count a swipe-away from the iOS app switcher (inactive) as unclean', () => {
    expect(markerAfterDeath(false, 'active', ['inactive']).markerOnDisk).toBe(false);
  });

  it('never keeps a stale marker from the previous process', () => {
    expect(decideAtLaunch(true, 'background')).toEqual({
      previousExitUnclean: true,
      action: 'clear',
    });
    expect(markerAfterDeath(true, 'background', []).markerOnDisk).toBe(false);
  });

  it('ignores the iOS edge states unknown and extension', () => {
    expect(markerActionOnChange('unknown')).toBe('keep');
    expect(markerActionOnChange('extension')).toBe('keep');
    expect(decideAtLaunch(false, 'unknown').action).toBe('write');
  });

  it('property: the next launch reports unclean iff the process died while active', () => {
    const state = fc.constantFrom(...STATES);
    fc.assert(
      fc.property(
        fc.boolean(),
        state,
        fc.array(state, { maxLength: 30 }),
        (before, initial, changes) => {
          const { reported, markerOnDisk } = markerAfterDeath(before, initial, changes);
          // This launch reports exactly what the previous process left.
          expect(reported).toBe(before);
          // The next launch will report unclean iff the last decisive state was active.
          expect(markerOnDisk).toBe(lastDecisiveState(initial, changes) === 'active');
        },
      ),
    );
  });

  it('property: over a chain of processes, each launch reports how the previous one ended', () => {
    const state = fc.constantFrom(...STATES);
    const proc = fc.record({ initial: state, changes: fc.array(state, { maxLength: 10 }) });
    fc.assert(
      fc.property(fc.array(proc, { minLength: 1, maxLength: 10 }), (processes) => {
        let marker = false;
        let previousDiedActive = false;
        for (const [i, p] of processes.entries()) {
          const { reported, markerOnDisk } = markerAfterDeath(marker, p.initial, p.changes);
          expect(reported).toBe(i === 0 ? false : previousDiedActive);
          marker = markerOnDisk;
          previousDiedActive = lastDecisiveState(p.initial, p.changes) === 'active';
        }
      }),
    );
  });
});
