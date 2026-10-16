/**
 * Bench orchestration of the Diagnostics screen (DG1 note §5.1, DS-5): everything runs on the JS thread, one case
 * at a time. A suite is a {@link Job}: `step()` runs exactly one case synchronously (a golden case, a bot decision,
 * a batch of 1,000 `has()` calls, one resume iteration) and is never split. Between two cases the runner yields to
 * the UI (`setTimeout(0)` on the device), so progress renders and Cancel is handled; the yield is outside every
 * measured interval because each case times itself. Cancel is cooperative: it is seen at the next case boundary.
 */

export type SuiteId = 'goldens' | 'micro' | 'bots' | 'resume' | 'drift';

/** Display order (note §5 table, suites 1–5). Suite 6 (responsiveness) is never part of a run. */
export const SUITE_ORDER: readonly SuiteId[] = ['goldens', 'micro', 'bots', 'resume', 'drift'];

/**
 * "Run all" order (review C-5): drift first, right after the settle delay, so its first match starts on a cool
 * phone and "last vs first" shows the thermal drift of 10 matches, not of 10 matches after 8 minutes of other
 * suites. The rest keeps the note order.
 */
export const RUN_ALL_ORDER: readonly SuiteId[] = ['drift', 'goldens', 'micro', 'bots', 'resume'];

/** Monotonic clock in milliseconds (fractions allowed): `performance.now()` on the device. */
export type Clock = () => number;

/** Non-zero deltas the resolution probe collects. */
export const CLOCK_PROBE_DELTAS = 20;
/** Readings after which the probe gives up on a clock that does not advance. */
export const CLOCK_PROBE_MAX_READS = 1_000_000;
/** Coarsest clock a timed bench accepts (review C-4); above it the bench is `not-measured`. */
export const MAX_CLOCK_RESOLUTION_US = 50;
/** The `not-measured` reason of a bench whose clock is too coarse (or does not advance). */
export const CLOCK_RESOLUTION = 'clock-resolution';

/**
 * The clock's resolution in µs: the smallest non-zero difference between two consecutive readings, over
 * {@link CLOCK_PROBE_DELTAS} of them. Null when the clock does not advance within {@link CLOCK_PROBE_MAX_READS}.
 */
export function clockResolutionUs(clock: Clock): number | null {
  let previous = clock();
  let smallest = Number.POSITIVE_INFINITY;
  let found = 0;
  for (let i = 0; i < CLOCK_PROBE_MAX_READS && found < CLOCK_PROBE_DELTAS; i += 1) {
    const now = clock();
    if (now > previous) {
      smallest = Math.min(smallest, now - previous);
      found += 1;
    }
    previous = now;
  }
  return found === 0 ? null : smallest * 1000;
}

/** True when `clock` can time a bench (resolution ≤ {@link MAX_CLOCK_RESOLUTION_US}). */
export function clockUsable(clock: Clock): boolean {
  const resolution = clockResolutionUs(clock);
  return resolution !== null && resolution <= MAX_CLOCK_RESOLUTION_US;
}

export interface JobProgress {
  readonly done: number;
  readonly total: number;
}

export interface Job<R> {
  readonly suite: SuiteId;
  /** Suites whose numbers are timings wait for the settle delay before the first one runs (note §4). */
  readonly timed: boolean;
  /** Runs one case. False once the suite is complete (then {@link result} is available). */
  step(): boolean;
  progress(): JobProgress;
  /** The suite's result; only valid after `step()` returned false. */
  result(): R;
  /** Releases what the suite holds outside memory (the resume probe's scratch directory). Never throws. */
  dispose(): void;
}

export interface RunControls {
  /** Lets the UI render and input be handled (device: `setTimeout(0)`). */
  readonly yieldToUi: () => Promise<void>;
  /** Waits before the first timed suite (device: 3 s, note §4), so the Settings transition has settled. */
  readonly settle: () => Promise<void>;
  /** True once Cancel was pressed, the modal closed or the app left the foreground. */
  readonly cancelled: () => boolean;
  readonly onSuiteStart?: (suite: SuiteId) => void;
  readonly onProgress?: (suite: SuiteId, progress: JobProgress) => void;
}

export type RunOutcome =
  | { readonly kind: 'completed'; readonly results: ReadonlyMap<SuiteId, unknown> }
  | { readonly kind: 'cancelled' }
  /** A suite threw outside its cases (a bug or out of memory): the run stops, nothing is kept. */
  | { readonly kind: 'failed'; readonly suite: SuiteId };

/**
 * Runs `jobs` in order, one case per step, yielding between cases. Cancel discards every result of the run (note
 * §5.1: no partial reports); every job is disposed whatever the outcome.
 */
export async function runJobs(
  jobs: readonly Job<unknown>[],
  controls: RunControls,
): Promise<RunOutcome> {
  const results = new Map<SuiteId, unknown>();
  let settled = false;
  try {
    for (const job of jobs) {
      if (controls.cancelled()) return { kind: 'cancelled' };
      if (job.timed && !settled) {
        settled = true;
        await controls.settle();
        if (controls.cancelled()) return { kind: 'cancelled' };
      }
      controls.onSuiteStart?.(job.suite);
      let more = true;
      while (more) {
        try {
          more = job.step();
        } catch {
          return { kind: 'failed', suite: job.suite };
        }
        controls.onProgress?.(job.suite, job.progress());
        await controls.yieldToUi();
        if (controls.cancelled()) return { kind: 'cancelled' };
      }
      results.set(job.suite, job.result());
    }
    return { kind: 'completed', results };
  } finally {
    for (const job of jobs) job.dispose();
  }
}

/** Device yield: one macrotask, so React commits and the input queue drains between two cases. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Device settle delay (note §4: the run waits 3 s before the first timed suite). */
export const SETTLE_MS = 3000;
