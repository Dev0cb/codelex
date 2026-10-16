/**
 * When the Summary shows "Would you play CODELEX again?" (E-1.5 AC-18, design §5.6; slice S6b). Pure: the recorder
 * keeps the state in one small file (`SURVEY_FILE`) and asks it when a Summary opens.
 *
 * - The card is due on the 1st and 3rd completed match, at most twice per install, once per completion (a Summary
 *   that mounts again for the same match does not show it again).
 * - `completed` counts matches completed while the survey is active (flag `playtest.survey.enabled` on and recording
 *   on). ASSUMPTION (S6b, reversible): an install that played before the flag was turned on is asked from its first
 *   match after that, not never; `matches_completed` on the events is this count.
 * - The state is a UI preference (design §13.3 "survey counters"), not an event: it is kept when consent is
 *   withdrawn, like the notice-seen choice, so the question is never asked more than twice per install. It holds
 *   three small counts, no answer, no time, no identifier, and never leaves the device.
 * - A file that cannot be read means "already asked twice": when the state is unknown, the app does not nag.
 */

/** Operator-chosen id of this survey on the events (`string id`); one per question set. */
export const SURVEY_ID = 'e1_5_playtest';
export const SURVEY_QUESTION_ID = 'would_play_again';
/** AC-18: the completed matches whose Summary asks. */
export const SURVEY_AT_MATCHES: readonly number[] = [1, 3];
/** AC-18: at most twice per install. */
export const SURVEY_MAX_SHOWN = 2;
/** File name in the backup-excluded data directory (owned by the recorder). */
export const SURVEY_FILE = 'survey.state';

const LAST_DUE = Math.max(...SURVEY_AT_MATCHES);

export interface SurveyState {
  /** Matches completed on this install while the survey was active (stops at the last due point). */
  readonly completed: number;
  /** Times the card was shown on this install. */
  readonly shown: number;
  /** `completed` when the card was last shown; 0 = never. */
  readonly shownAt: number;
}

export const INITIAL_SURVEY: SurveyState = { completed: 0, shown: 0, shownAt: 0 };

/** What an unreadable file means: never shown again. */
export const SURVEY_UNREADABLE: SurveyState = {
  completed: LAST_DUE,
  shown: SURVEY_MAX_SHOWN,
  shownAt: LAST_DUE,
};

/** A match reached its end. Past the last due point nothing changes (same object: no write). */
export function noteSurveyMatchCompleted(state: SurveyState): SurveyState {
  if (state.completed >= LAST_DUE) return state;
  return { ...state, completed: state.completed + 1 };
}

export function isSurveyDue(state: SurveyState): boolean {
  return (
    SURVEY_AT_MATCHES.includes(state.completed) &&
    state.shown < SURVEY_MAX_SHOWN &&
    state.shownAt !== state.completed
  );
}

export function noteSurveyShown(state: SurveyState): SurveyState {
  return { ...state, shown: state.shown + 1, shownAt: state.completed };
}

export function encodeSurveyState(state: SurveyState): string {
  return JSON.stringify({ v: 1, ...state });
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** The state in a file record; anything malformed is {@link SURVEY_UNREADABLE}. */
export function decodeSurveyState(text: string): SurveyState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return SURVEY_UNREADABLE;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return SURVEY_UNREADABLE;
  }
  const { v, completed, shown, shownAt } = parsed as Record<string, unknown>;
  if (v !== 1 || !isCount(completed) || !isCount(shown) || !isCount(shownAt)) {
    return SURVEY_UNREADABLE;
  }
  return { completed, shown, shownAt };
}
