/**
 * Types of the runner core. They describe the same document as the `runnerFormat` 1 schema (`../runner-report.ts`)
 * without importing zod, so the core entry stays zod-free for the app bundle (DG1). `observed` is typed `unknown`
 * here: the Node host parses every report with the schema before printing it, and the tests do the same.
 */

/** Runtime block of the report (not compared, ADR-0016 §D3.2). Supplied by the host. */
export type CoreRuntime =
  | { readonly kind: 'node'; readonly version: string }
  | {
      readonly kind: 'hermes-cli' | 'hermes-app';
      readonly version: string;
      readonly bytecodeVersion: number;
    };

export type CoreCase =
  | { readonly id: string; readonly status: 'pass' | 'fail'; readonly observed: unknown }
  | { readonly id: string; readonly status: 'error'; readonly errorCode: string };

export interface CoreSuite {
  readonly id: string;
  readonly cases: readonly CoreCase[];
  readonly summary: { readonly pass: number; readonly fail: number; readonly error: number };
}

export interface CoreReport {
  readonly runnerFormat: 1;
  readonly runtime: CoreRuntime;
  readonly corpus: {
    readonly digest: string;
    readonly engineRulesVersions: readonly number[];
    readonly botVersion: number;
  };
  readonly suites: readonly CoreSuite[];
  readonly verdict: 'pass' | 'fail';
  readonly timings?: Readonly<Record<string, { readonly totalMs: number }>>;
}

/**
 * What a host injects (ADR-0016 §D3 item 2: "timings injected by the host"): its runtime block and, optionally, a
 * monotonic clock in integer milliseconds. Without a clock the report has no `timings`.
 */
export interface RunnerHost {
  readonly runtime: CoreRuntime;
  readonly clock?: () => number;
}
