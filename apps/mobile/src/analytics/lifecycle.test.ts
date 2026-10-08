/**
 * `app_opened` and `app_backgrounded.foreground_ms` (catalogue "App lifecycle properties", data-analyst notes D1):
 * one `app_opened` per move to the foreground, the first of the process is the cold start (once the first route is
 * interactive), each move to the background closes the foreground interval with its monotonic length.
 */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  INITIAL_LIFECYCLE,
  stepLifecycle,
  type LifecycleInput,
  type LifecycleState,
} from './lifecycle';
import type { AppStateValue } from './session-marker';

function run(inputs: readonly LifecycleInput[]): { state: LifecycleState; emitted: string[] } {
  let state = INITIAL_LIFECYCLE;
  const emitted: string[] = [];
  for (const input of inputs) {
    const step = stepLifecycle(state, input);
    state = step.state;
    for (const e of step.emit) {
      emitted.push(
        e.event === 'app_opened' ? (e.cold ? 'cold' : 'warm') : `bg:${String(e.foregroundMs)}`,
      );
    }
  }
  return { state, emitted };
}

const app = (next: AppStateValue, at: number): LifecycleInput => ({ type: 'app_state', next, at });
const ready = (at: number): LifecycleInput => ({ type: 'interactive', at });

describe('app lifecycle events', () => {
  it('emits the cold app_opened once active and interactive, then foreground_ms at background', () => {
    expect(run([app('active', 10), ready(900), app('background', 60_010)]).emitted).toEqual([
      'cold',
      'bg:60000',
    ]);
  });

  it('waits for the first route even when the app was active first, or the other way round', () => {
    expect(run([ready(5), app('active', 10)]).emitted).toEqual(['cold']);
    expect(
      run([app('active', 10), app('background', 20), ready(30), app('active', 40)]).emitted,
    ).toEqual(['bg:10', 'cold']);
  });

  it('emits a warm app_opened on every later return to the foreground', () => {
    const { emitted } = run([
      app('active', 0),
      ready(1),
      app('background', 100),
      app('active', 1000),
      app('background', 1500),
      app('active', 9000),
    ]);
    expect(emitted).toEqual(['cold', 'bg:100', 'warm', 'bg:500', 'warm']);
  });

  it('treats iOS inactive as still in the foreground (app switcher, notification centre)', () => {
    const { emitted } = run([
      app('unknown', 0),
      app('active', 0),
      ready(1),
      app('inactive', 50),
      app('active', 60),
      app('inactive', 70),
      app('background', 80),
    ]);
    expect(emitted).toEqual(['cold', 'bg:80']);
  });

  it('restarts the open interval when recording starts mid-session (consent turned on)', () => {
    const { emitted } = run([
      app('active', 0),
      ready(1),
      { type: 'restart', at: 400 },
      app('background', 1000),
      { type: 'restart', at: 2000 },
    ]);
    expect(emitted).toEqual(['cold', 'bg:600']);
  });

  it('rounds to whole milliseconds and never reports a negative length', () => {
    expect(run([app('active', 10.2), ready(11), app('background', 20.9)]).emitted).toEqual([
      'cold',
      'bg:11',
    ]);
    expect(run([app('active', 10), app('background', 5)]).emitted).toEqual(['bg:0']);
  });

  it('sums foreground intervals to the time spent active, for any sequence (property)', () => {
    const states: AppStateValue[] = ['active', 'background', 'inactive', 'unknown'];
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...states), fc.integer({ min: 0, max: 1000 }))),
        (steps) => {
          let at = 0;
          let state = INITIAL_LIFECYCLE;
          let opened = 0;
          let colds = 0;
          let total = 0;
          let expected = 0;
          let since: number | null = null;
          for (const [next, gap] of steps) {
            at += gap;
            const step = stepLifecycle(state, app(next, at));
            state = step.state;
            if (next === 'active' && since === null) since = at;
            if (next === 'background' && since !== null) {
              expected += at - since;
              since = null;
            }
            for (const e of step.emit) {
              if (e.event === 'app_backgrounded') total += e.foregroundMs;
              else {
                opened += 1;
                if (e.cold) colds += 1;
              }
            }
            if (at === 500) state = stepLifecycle(state, ready(at)).state;
          }
          expect(total).toBe(expected);
          expect(colds).toBeLessThanOrEqual(1);
          expect(opened).toBeLessThanOrEqual(steps.filter(([n]) => n === 'active').length);
        },
      ),
    );
  });
});
