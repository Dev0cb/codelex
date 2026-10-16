/**
 * DG1 note §5.1 (DS-5): one case per step, a yield between cases, cooperative cancel at the next case boundary with
 * every result of the run discarded, a settle delay before the first timed suite, and `dispose` on every exit.
 */
import { describe, expect, it } from '@jest/globals';

import { runJobs, SUITE_ORDER, yieldToUi, type Job, type RunControls, type SuiteId } from './job';

function fakeJob(suite: SuiteId, cases: number, timed: boolean, log: string[]): Job<string> {
  let done = 0;
  return {
    suite,
    timed,
    step() {
      if (suite === 'drift' && done === 1) throw new Error('boom');
      done += 1;
      log.push(`${suite}:${String(done)}`);
      return done < cases;
    },
    progress: () => ({ done, total: cases }),
    result: () => `${suite}-result`,
    dispose: () => {
      log.push(`dispose:${suite}`);
    },
  };
}

function controls(log: string[], cancelAfter = Number.POSITIVE_INFINITY): RunControls {
  let yields = 0;
  return {
    yieldToUi: () => {
      yields += 1;
      log.push('yield');
      return Promise.resolve();
    },
    settle: () => {
      log.push('settle');
      return Promise.resolve();
    },
    cancelled: () => yields >= cancelAfter,
    onSuiteStart: (suite) => log.push(`start:${suite}`),
  };
}

describe('runJobs', () => {
  it('runs suites in order, one case per step, yielding between cases', async () => {
    const log: string[] = [];
    const outcome = await runJobs(
      [fakeJob('goldens', 2, false, log), fakeJob('micro', 2, true, log)],
      controls(log),
    );
    expect(outcome.kind).toBe('completed');
    expect(outcome.kind === 'completed' && [...outcome.results.entries()]).toEqual([
      ['goldens', 'goldens-result'],
      ['micro', 'micro-result'],
    ]);
    expect(log).toEqual([
      'start:goldens',
      'goldens:1',
      'yield',
      'goldens:2',
      'yield',
      'settle',
      'start:micro',
      'micro:1',
      'yield',
      'micro:2',
      'yield',
      'dispose:goldens',
      'dispose:micro',
    ]);
  });

  it('cancels at the next case boundary, keeps nothing and disposes every job', async () => {
    const log: string[] = [];
    const outcome = await runJobs(
      [fakeJob('goldens', 5, false, log), fakeJob('resume', 5, true, log)],
      controls(log, 2),
    );
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(log.filter((l) => l.startsWith('goldens:'))).toEqual(['goldens:1', 'goldens:2']);
    expect(log).not.toContain('start:resume');
    expect(log.slice(-2)).toEqual(['dispose:goldens', 'dispose:resume']);
  });

  it('a case that throws stops the run as failed', async () => {
    const log: string[] = [];
    const outcome = await runJobs([fakeJob('drift', 3, true, log)], controls(log));
    expect(outcome).toEqual({ kind: 'failed', suite: 'drift' });
    expect(log).toContain('dispose:drift');
  });

  it('checks cancel before starting and after the settle delay', async () => {
    const log: string[] = [];
    expect(await runJobs([fakeJob('micro', 1, true, log)], controls(log, 0))).toEqual({
      kind: 'cancelled',
    });
    let settled = false;
    const late: RunControls = {
      yieldToUi: () => Promise.resolve(),
      settle: () => {
        settled = true;
        return Promise.resolve();
      },
      cancelled: () => settled,
    };
    expect(await runJobs([fakeJob('micro', 1, true, [])], late)).toEqual({ kind: 'cancelled' });
  });

  it('runs suites 1–5 in the note order; the device yield is a macrotask', async () => {
    expect(SUITE_ORDER).toEqual(['goldens', 'micro', 'bots', 'resume', 'drift']);
    await expect(yieldToUi()).resolves.toBeUndefined();
  });
});
