/**
 * State of the Diagnostics screen (DG1 note §5.1): which suites ran, the current suite and its progress, and the
 * results kept from completed runs. A run is all-or-nothing: Cancel (button, Android back, closing the modal) or the
 * app leaving the foreground stops it at the next case boundary and discards every result of that run; the scratch
 * directory is deleted on every exit (the jobs' `dispose`). Results live in memory only.
 */
import { GOLDEN_CORPUS, type CoreReport, type GoldenCorpus } from '@codelex/golden-runner/core';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { RuntimeCheck } from './device-info';
import { botsJob, type BotsResult } from './jobs/bots';
import { driftJob, type DriftResult } from './jobs/drift';
import { goldensJob } from './jobs/goldens';
import { runJobs, type Clock, type Job, type JobProgress, type SuiteId } from './jobs/job';
import { microJob, type MicroResult } from './jobs/micro';
import { resumeJob, type ResumeResult } from './jobs/resume';
import type { ScratchStore } from './scratch-fs';

/** Case counts per suite; the defaults are the note's (tests use small ones). */
export interface JobSizes {
  readonly positions?: number;
  readonly hasBatches?: number;
  readonly applyPasses?: number;
  readonly resumeMatches?: number;
  readonly resumeIterations?: number;
  readonly driftMatches?: number;
}

export interface DiagnosticsDeps {
  readonly lexicon: LexiconIndex;
  readonly clock: Clock;
  readonly store: ScratchStore;
  readonly runtime: RuntimeCheck;
  readonly yieldToUi: () => Promise<void>;
  readonly settle: () => Promise<void>;
  readonly corpus?: GoldenCorpus;
  readonly sizes?: JobSizes;
}

export interface SuiteResults {
  readonly goldens?: CoreReport;
  readonly micro?: MicroResult;
  readonly bots?: BotsResult;
  readonly resume?: ResumeResult;
  readonly drift?: DriftResult;
}

export type Phase = 'idle' | 'running' | 'done' | 'cancelled' | 'interrupted' | 'failed';

export interface DiagnosticsState {
  readonly phase: Phase;
  readonly suite: SuiteId | null;
  readonly progress: JobProgress | null;
  readonly results: SuiteResults;
}

function keep<R>(job: Job<R>, save: (result: R) => void): Job<unknown> {
  return {
    suite: job.suite,
    timed: job.timed,
    step: () => job.step(),
    progress: () => job.progress(),
    result: () => {
      const result = job.result();
      save(result);
      return result;
    },
    dispose: () => {
      job.dispose();
    },
  };
}

/** The jobs of `suites`, in "Run all" order, each saving its result into `out`. */
export function jobsFor(
  suites: readonly SuiteId[],
  deps: DiagnosticsDeps,
  out: { -readonly [K in keyof SuiteResults]: SuiteResults[K] },
): Job<unknown>[] {
  const { lexicon, clock, sizes = {} } = deps;
  const corpus = deps.corpus ?? GOLDEN_CORPUS;
  return suites.map((suite) => {
    switch (suite) {
      case 'goldens':
        return keep(goldensJob(deps.runtime.runtime, clock, corpus), (r) => (out.goldens = r));
      case 'micro':
        return keep(
          microJob(lexicon, clock, {
            corpus,
            ...(sizes.hasBatches === undefined ? {} : { hasBatches: sizes.hasBatches }),
            ...(sizes.applyPasses === undefined ? {} : { applyPasses: sizes.applyPasses }),
          }),
          (r) => (out.micro = r),
        );
      case 'bots':
        return keep(botsJob(lexicon, clock, sizes.positions), (r) => (out.bots = r));
      case 'resume':
        return keep(
          resumeJob(lexicon, clock, deps.store, {
            ...(sizes.resumeMatches === undefined ? {} : { matches: sizes.resumeMatches }),
            ...(sizes.resumeIterations === undefined ? {} : { iterations: sizes.resumeIterations }),
          }),
          (r) => (out.resume = r),
        );
      case 'drift':
        return keep(driftJob(lexicon, clock, sizes.driftMatches), (r) => (out.drift = r));
    }
  });
}

export interface DiagnosticsRun {
  readonly state: DiagnosticsState;
  /** Starts a run of `suites` (no-op while one is running). */
  readonly start: (suites: readonly SuiteId[]) => void;
  /** Stops the run at the next case boundary and discards its results. */
  readonly cancel: () => void;
}

const IDLE: DiagnosticsState = { phase: 'idle', suite: null, progress: null, results: {} };

export function useDiagnosticsRun(deps: DiagnosticsDeps): DiagnosticsRun {
  const [state, setState] = useState<DiagnosticsState>(IDLE);
  const running = useRef(false);
  const stop = useRef<'cancelled' | 'interrupted' | null>(null);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const cancel = useCallback(() => {
    if (running.current) stop.current ??= 'cancelled';
  }, []);

  // A run outlives the screen (closing the modal cancels it at the next case boundary): no state after unmount.
  const mounted = useRef(true);
  const update = useCallback((next: (s: DiagnosticsState) => DiagnosticsState) => {
    if (mounted.current) setState(next);
  }, []);

  const start = useCallback(
    (suites: readonly SuiteId[]) => {
      if (running.current) return;
      running.current = true;
      stop.current = null;
      const current = depsRef.current;
      const out: { -readonly [K in keyof SuiteResults]: SuiteResults[K] } = {};
      update((s) => ({ ...s, phase: 'running', suite: suites[0] ?? null, progress: null }));
      const ended = (phase: Phase): void => {
        running.current = false;
        update((s) => ({ ...s, phase, suite: null, progress: null }));
      };
      // The jobs are built inside the chain, so a throw while building one also ends the run as failed.
      Promise.resolve()
        .then(() =>
          runJobs(jobsFor(suites, current, out), {
            yieldToUi: current.yieldToUi,
            settle: current.settle,
            cancelled: () => stop.current !== null,
            onSuiteStart: (suite) => {
              update((s) => ({ ...s, suite, progress: null }));
            },
            onProgress: (suite, progress) => {
              update((s) => ({ ...s, suite, progress }));
            },
          }),
        )
        .then(
          (outcome) => {
            if (outcome.kind !== 'completed') {
              ended(outcome.kind === 'failed' ? 'failed' : (stop.current ?? 'cancelled'));
              return;
            }
            running.current = false;
            update((s) => ({
              phase: 'done',
              suite: null,
              progress: null,
              results: { ...s.results, ...out },
            }));
          },
          // A rejection outside a case (the settle delay, a yield, a result, a dispose): nothing is kept.
          () => {
            ended('failed');
          },
        );
    },
    [update],
  );

  // Background timings are meaningless (note §5.1): going to the background cancels the run. Only 'background':
  // iOS reports 'inactive' for Notification Centre, Control Centre or a system alert, while the app stays in the
  // foreground and keeps running, so the run is still valid.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' && running.current) stop.current ??= 'interrupted';
    });
    return () => {
      subscription.remove();
    };
  }, []);

  // Closing the modal (unmount) cancels too; the jobs delete the scratch directory as the run unwinds.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (running.current) stop.current ??= 'cancelled';
    };
  }, []);

  return { state, start, cancel };
}
