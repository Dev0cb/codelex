/** End-of-session export prompt rules (E-1.5 D-17, Q-12; slice S6c). */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  INITIAL_PROMPT_SESSION,
  isPromptDue,
  PROMPT_COOLDOWN_MS,
  PROMPT_MIN_FOREGROUND_MS,
  SESSION_GAP_MS,
  sessionForegroundMs,
  stepPromptSession,
  type PromptInput,
  type PromptSession,
} from './export-prompt';

const MIN = 60 * 1000;
const WALL = Date.parse('2026-10-14T18:00:00.000Z');

const run = (inputs: readonly PromptInput[]): PromptSession =>
  inputs.reduce(stepPromptSession, INITIAL_PROMPT_SESSION);
const active = (at: number): PromptInput => ({ type: 'app_state', next: 'active', at });
const background = (at: number): PromptInput => ({ type: 'app_state', next: 'background', at });
const match: PromptInput = { type: 'match_completed' };
const ctx = (nowMono: number, over: Partial<Parameters<typeof isPromptDue>[1]> = {}) => ({
  nowMono,
  nowWall: WALL,
  unsent: 10,
  lastShownWall: null,
  ...over,
});

describe('export prompt (D-17)', () => {
  it('needs one completed match and either two matches or 8 minutes in the foreground', () => {
    expect(isPromptDue(run([active(0)]), ctx(60 * MIN))).toBe(false);
    const one = run([active(0), match]);
    expect(isPromptDue(one, ctx(PROMPT_MIN_FOREGROUND_MS - 1))).toBe(false);
    expect(isPromptDue(one, ctx(PROMPT_MIN_FOREGROUND_MS))).toBe(true);
    expect(isPromptDue(run([active(0), match, match]), ctx(MIN))).toBe(true);
  });

  it('needs at least one unsent event', () => {
    expect(isPromptDue(run([active(0), match, match]), ctx(MIN, { unsent: 0 }))).toBe(false);
  });

  it('shows at most once per session, and not again within 24 h', () => {
    const shown = run([active(0), match, match, { type: 'shown' }]);
    expect(isPromptDue(shown, ctx(MIN))).toBe(false);
    const due = run([active(0), match, match]);
    expect(isPromptDue(due, ctx(MIN, { lastShownWall: WALL - PROMPT_COOLDOWN_MS + 1 }))).toBe(
      false,
    );
    expect(isPromptDue(due, ctx(MIN, { lastShownWall: WALL - PROMPT_COOLDOWN_MS }))).toBe(true);
    // A clock set back before the last display does not hold the card back forever.
    expect(isPromptDue(due, ctx(MIN, { lastShownWall: WALL + MIN }))).toBe(true);
  });

  it('sums foreground intervals of one session; inactive does not end one', () => {
    const state = run([
      active(0),
      { type: 'app_state', next: 'inactive', at: 2 * MIN },
      background(5 * MIN),
      background(6 * MIN),
      active(10 * MIN),
      active(11 * MIN),
    ]);
    expect(sessionForegroundMs(state, 13 * MIN)).toBe(8 * MIN);
    expect(isPromptDue(stepPromptSession(state, match), ctx(13 * MIN))).toBe(true);
  });

  it('starts a new session after 30 min in the background (Q-12)', () => {
    const before = run([active(0), match, match, { type: 'shown' }, background(10 * MIN)]);
    const kept = stepPromptSession(before, active(10 * MIN + SESSION_GAP_MS - 1));
    expect(kept.matches).toBe(2);
    expect(kept.shown).toBe(true);
    const fresh = stepPromptSession(before, active(10 * MIN + SESSION_GAP_MS));
    expect(fresh).toEqual({
      ...INITIAL_PROMPT_SESSION,
      foregroundSince: 10 * MIN + SESSION_GAP_MS,
    });
  });

  it('property: foreground time never decreases within a session and is never negative', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            next: fc.constantFrom('active', 'background', 'inactive', 'unknown'),
            dt: fc.integer({ min: 0, max: 20 * MIN }),
          }),
          { maxLength: 30 },
        ),
        (moves) => {
          let at = 0;
          let state = INITIAL_PROMPT_SESSION;
          let last = 0;
          for (const { next, dt } of moves) {
            at += dt;
            const after = stepPromptSession(state, {
              type: 'app_state',
              next: next as 'active',
              at,
            });
            const total = sessionForegroundMs(after, at);
            expect(total).toBeGreaterThanOrEqual(0);
            const reset = after.foregroundMs < state.foregroundMs;
            if (!reset) expect(total).toBeGreaterThanOrEqual(last);
            last = total;
            state = after;
          }
        },
      ),
    );
  });
});
