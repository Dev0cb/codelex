/**
 * `previous_exit_unclean` semantics (OQ-SP2-4, sprint 4 D1): a process that dies while user-facing (including during
 * startup) is an unclean exit; one that dies in the background, or `inactive` after use (OS low-memory kill,
 * swipe-away), is not.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  decideAtLaunch,
  onAppStateChange,
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

/** One process: launch, then the `AppState` reports, then death. Returns what the next cold start reads. */
function run(
  markerBefore: boolean,
  reports: readonly AppStateValue[],
): { readonly reported: boolean; readonly markerOnDisk: boolean } {
  const launch = decideAtLaunch(markerBefore);
  let state = launch.state;
  for (const next of reports) state = onAppStateChange(state, next);
  return { reported: launch.previousExitUnclean, markerOnDisk: state.present };
}

/**
 * Independent oracle, written from the catalogue definition rather than from the state machine: did the process die
 * while user-facing? Look at what happened after the last `active` (or since launch if there was none).
 */
function diedUserFacing(reports: readonly AppStateValue[]): boolean {
  const lastActive = reports.lastIndexOf('active');
  if (lastActive < 0) {
    // Still starting up: only an explicit move to the background makes it not user-facing.
    return !reports.includes('background');
  }
  const after = reports.slice(lastActive + 1);
  return !after.includes('background') && !after.includes('inactive');
}

describe('session marker (previous_exit_unclean)', () => {
  it('lives in the backup-excluded data directory under a fixed name', () => {
    expect(SESSION_MARKER_FILE).toBe('session.open');
  });

  it('reports false on a first launch and always writes the marker at launch', () => {
    expect(decideAtLaunch(false)).toEqual({
      previousExitUnclean: false,
      state: { present: true, seenActive: false },
    });
    expect(decideAtLaunch(true).previousExitUnclean).toBe(true);
  });

  it('counts a crash at boot as unclean, before any AppState report', () => {
    expect(run(false, []).markerOnDisk).toBe(true);
  });

  it('counts an iOS launch through inactive that dies before active as unclean', () => {
    expect(run(false, ['inactive']).markerOnDisk).toBe(true);
    expect(run(false, ['unknown', 'inactive']).markerOnDisk).toBe(true);
  });

  it('counts a crash or kill while active as unclean', () => {
    expect(run(false, ['active']).markerOnDisk).toBe(true);
    expect(run(false, ['active', 'background', 'active']).markerOnDisk).toBe(true);
  });

  it('does not count an OS kill in the background (low-memory kill) as unclean', () => {
    expect(run(false, ['active', 'background']).markerOnDisk).toBe(false);
    expect(run(true, ['background']).markerOnDisk).toBe(false);
  });

  it('does not count a swipe-away from the iOS app switcher (inactive after use) as unclean', () => {
    expect(run(false, ['inactive', 'active', 'inactive']).markerOnDisk).toBe(false);
  });

  it('ignores the iOS edge states unknown and extension', () => {
    const state = { present: true, seenActive: true };
    expect(onAppStateChange(state, 'unknown')).toBe(state);
    expect(onAppStateChange(state, 'extension')).toBe(state);
  });

  it('property: the next launch reports unclean iff the process died user-facing (independent oracle)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(fc.constantFrom(...STATES), { maxLength: 30 }),
        (before, reports) => {
          const { reported, markerOnDisk } = run(before, reports);
          expect(reported).toBe(before);
          expect(markerOnDisk).toBe(diedUserFacing(reports));
        },
      ),
    );
  });

  it('property: over a chain of processes, each launch reports how the previous one ended', () => {
    const proc = fc.array(fc.constantFrom(...STATES), { maxLength: 10 });
    fc.assert(
      fc.property(fc.array(proc, { minLength: 1, maxLength: 10 }), (processes) => {
        let marker = false;
        let previous: readonly AppStateValue[] | null = null;
        for (const reports of processes) {
          const { reported, markerOnDisk } = run(marker, reports);
          expect(reported).toBe(previous === null ? false : diedUserFacing(previous));
          marker = markerOnDisk;
          previous = reports;
        }
      }),
    );
  });
});
