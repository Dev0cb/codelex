/**
 * When `app_opened` and `app_backgrounded` fire (catalogue "App lifecycle properties" and data-analyst notes D1).
 * Pure: the recorder feeds it `AppState` reports and the monotonic clock, and records what it emits.
 *
 * - The app is in the foreground from a move to `active` until a move to `background`. iOS `inactive` (app switcher,
 *   notification centre, call banner) does not end the interval, and `active` after it does not start a new one.
 * - Each move to the foreground emits `app_opened`. The first one of the process is the cold start: it waits until the
 *   first route is interactive (E-1.5 design §11: "Home first rendered"), and carries `cold_start_ms` and
 *   `previous_exit_unclean` (added by the recorder).
 * - Each move to the background emits `app_backgrounded.foreground_ms`: the interval's length on the monotonic
 *   clock, so a wall-clock change never distorts session length.
 * - `restart` (recording starts mid-session, when the tester turns consent on) restarts the open interval: time
 *   before consent is never measured.
 */
import type { AppStateValue } from './session-marker';

export interface LifecycleState {
  /** Monotonic ms when the current foreground interval began; null while in the background. */
  readonly foregroundSince: number | null;
  /** The first route has rendered. */
  readonly interactive: boolean;
  /** The cold `app_opened` of this process was emitted. */
  readonly opened: boolean;
}

export const INITIAL_LIFECYCLE: LifecycleState = {
  foregroundSince: null,
  interactive: false,
  opened: false,
};

export type LifecycleInput =
  | { readonly type: 'app_state'; readonly next: AppStateValue; readonly at: number }
  | { readonly type: 'interactive'; readonly at: number }
  | { readonly type: 'restart'; readonly at: number };

export type LifecycleEmission =
  | { readonly event: 'app_opened'; readonly cold: boolean }
  | { readonly event: 'app_backgrounded'; readonly foregroundMs: number };

export interface LifecycleStep {
  readonly state: LifecycleState;
  readonly emit: readonly LifecycleEmission[];
}

const NOTHING: readonly LifecycleEmission[] = [];

function opened(state: LifecycleState): LifecycleStep {
  if (state.opened) return { state, emit: [{ event: 'app_opened', cold: false }] };
  if (!state.interactive) return { state, emit: NOTHING };
  return { state: { ...state, opened: true }, emit: [{ event: 'app_opened', cold: true }] };
}

export function stepLifecycle(state: LifecycleState, input: LifecycleInput): LifecycleStep {
  switch (input.type) {
    case 'interactive': {
      const next = { ...state, interactive: true };
      if (state.opened || state.foregroundSince === null) return { state: next, emit: NOTHING };
      return opened(next);
    }
    case 'restart':
      return state.foregroundSince === null
        ? { state, emit: NOTHING }
        : { state: { ...state, foregroundSince: input.at }, emit: NOTHING };
    case 'app_state':
      if (input.next === 'active') {
        if (state.foregroundSince !== null) return { state, emit: NOTHING };
        return opened({ ...state, foregroundSince: input.at });
      }
      if (input.next === 'background' && state.foregroundSince !== null) {
        const foregroundMs = Math.max(0, Math.round(input.at - state.foregroundSince));
        return {
          state: { ...state, foregroundSince: null },
          emit: [{ event: 'app_backgrounded', foregroundMs }],
        };
      }
      return { state, emit: NOTHING };
  }
}
