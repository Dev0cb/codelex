/**
 * When Home shows the end-of-session "Send your playtest data?" card (E-1.5 AC-17, design D-17; slice S6c). Pure:
 * the recorder feeds it `AppState` moves on the monotonic clock and completed matches, and asks it on Home.
 *
 * - Session (spec Q-12): foreground time, closed after 30 min in the background. A new session restarts the match
 *   count, the foreground total and "shown this session".
 * - Due when: not shown this session, ≥ 1 match completed this session, ≥ 1 unsent event, and (≥ 2 matches this
 *   session or ≥ 8 min in the foreground this session), and not within 24 h of the last time it was shown on this
 *   install (device clock; the last time is kept on disk by the recorder). A device clock set back before that time
 *   does not hold the card back forever: a negative age counts as elapsed.
 */
import type { AppStateValue } from './session-marker';

/** Q-12: a session closes after 30 min in the background. */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/** D-17: ≥ 8 min in the foreground (with one match) is enough. */
export const PROMPT_MIN_FOREGROUND_MS = 8 * 60 * 1000;
/** D-17: two completed matches are enough. */
export const PROMPT_MIN_MATCHES = 2;
/** D-17 cool-down between two displays. */
export const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface PromptSession {
  /** Matches completed in this session. */
  readonly matches: number;
  /** Foreground ms of the intervals of this session already closed. */
  readonly foregroundMs: number;
  /** Monotonic ms the open foreground interval began; null in the background. */
  readonly foregroundSince: number | null;
  /** Monotonic ms the app went to the background; null in the foreground or before the first report. */
  readonly backgroundSince: number | null;
  readonly shown: boolean;
}

export const INITIAL_PROMPT_SESSION: PromptSession = {
  matches: 0,
  foregroundMs: 0,
  foregroundSince: null,
  backgroundSince: null,
  shown: false,
};

export type PromptInput =
  | { readonly type: 'app_state'; readonly next: AppStateValue; readonly at: number }
  | { readonly type: 'match_completed' }
  | { readonly type: 'shown' };

export function stepPromptSession(state: PromptSession, input: PromptInput): PromptSession {
  switch (input.type) {
    case 'match_completed':
      return { ...state, matches: state.matches + 1 };
    case 'shown':
      return { ...state, shown: true };
    case 'app_state':
      if (input.next === 'active') {
        if (state.foregroundSince !== null) return state;
        const closed =
          state.backgroundSince !== null && input.at - state.backgroundSince >= SESSION_GAP_MS;
        const base = closed ? INITIAL_PROMPT_SESSION : state;
        return { ...base, foregroundSince: input.at, backgroundSince: null };
      }
      if (input.next === 'background' && state.foregroundSince !== null) {
        return {
          ...state,
          foregroundMs: state.foregroundMs + Math.max(0, input.at - state.foregroundSince),
          foregroundSince: null,
          backgroundSince: input.at,
        };
      }
      return state;
  }
}

export interface PromptContext {
  readonly nowMono: number;
  readonly nowWall: number;
  readonly unsent: number;
  /** Device-clock ms of the last display on this install; null if never shown. */
  readonly lastShownWall: number | null;
}

/** Foreground ms of the session so far, the open interval included. */
export function sessionForegroundMs(state: PromptSession, nowMono: number): number {
  const open = state.foregroundSince === null ? 0 : Math.max(0, nowMono - state.foregroundSince);
  return state.foregroundMs + open;
}

export function isPromptDue(state: PromptSession, ctx: PromptContext): boolean {
  if (state.shown || state.matches < 1 || ctx.unsent < 1) return false;
  const engaged =
    state.matches >= PROMPT_MIN_MATCHES ||
    sessionForegroundMs(state, ctx.nowMono) >= PROMPT_MIN_FOREGROUND_MS;
  if (!engaged) return false;
  if (ctx.lastShownWall === null) return true;
  const age = ctx.nowWall - ctx.lastShownWall;
  return age < 0 || age >= PROMPT_COOLDOWN_MS;
}
