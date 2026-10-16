/**
 * When the "Would you play CODELEX again?" card is due (E-1.5 AC-18, design §5.6; slice S6b): on the 1st and 3rd
 * completed match only, at most twice per install, once per completion, and an unreadable state never nags.
 */
import { describe, expect, it } from '@jest/globals';

import { GUARD_STRING_ID } from './event-guard';
import {
  decodeSurveyState,
  encodeSurveyState,
  INITIAL_SURVEY,
  isSurveyDue,
  noteSurveyShown,
  noteSurveyMatchCompleted,
  SURVEY_AT_MATCHES,
  SURVEY_ID,
  SURVEY_MAX_SHOWN,
  SURVEY_UNREADABLE,
  type SurveyState,
} from './survey';

/** The state after `n` completed matches, showing the card whenever it is due. */
function play(n: number, from: SurveyState = INITIAL_SURVEY): { state: SurveyState; at: number[] } {
  let state = from;
  const at: number[] = [];
  for (let i = 0; i < n; i += 1) {
    state = noteSurveyMatchCompleted(state);
    if (isSurveyDue(state)) {
      at.push(state.completed);
      state = noteSurveyShown(state);
    }
  }
  return { state, at };
}

describe('playtest survey schedule (AC-18)', () => {
  it('is due on the 1st and 3rd completed match only, twice in all', () => {
    expect(SURVEY_AT_MATCHES).toEqual([1, 3]);
    expect(SURVEY_MAX_SHOWN).toBe(2);
    expect(isSurveyDue(INITIAL_SURVEY)).toBe(false);
    const { state, at } = play(10);
    expect(at).toEqual([1, 3]);
    expect(state.shown).toBe(2);
  });

  it('is not due twice for the same completion (the Summary mounting again)', () => {
    const first = noteSurveyMatchCompleted(INITIAL_SURVEY);
    expect(isSurveyDue(first)).toBe(true);
    expect(isSurveyDue(noteSurveyShown(first))).toBe(false);
  });

  it('stops counting once the last showing is past (no write per match after that)', () => {
    const { state } = play(3);
    expect(noteSurveyMatchCompleted(state)).toBe(state);
  });

  it('never exceeds two showings, even from a state that already holds two', () => {
    const saturated: SurveyState = { completed: 0, shown: 2, shownAt: 0 };
    expect(play(5, saturated).at).toEqual([]);
  });

  it('round-trips through its file record and reads garbage as "never again"', () => {
    const { state } = play(1);
    expect(decodeSurveyState(encodeSurveyState(state))).toEqual(state);
    for (const bad of [
      '',
      'nope',
      '[]',
      'null',
      '{"v":2,"completed":1,"shown":0,"shownAt":0}',
      '{"v":1,"completed":-1,"shown":0,"shownAt":0}',
      '{"v":1,"completed":1.5,"shown":0,"shownAt":0}',
      '{"v":1,"completed":1,"shown":"1","shownAt":0}',
      '{"v":1,"completed":1,"shown":0}',
    ]) {
      expect(decodeSurveyState(bad)).toEqual(SURVEY_UNREADABLE);
    }
    expect(play(5, SURVEY_UNREADABLE).at).toEqual([]);
  });

  it('uses a survey id the event guard accepts', () => {
    expect(GUARD_STRING_ID.test(SURVEY_ID)).toBe(true);
  });
});
