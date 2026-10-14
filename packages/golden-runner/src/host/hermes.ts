/**
 * Hermes CLI host (ADR-0016 §D3 item 2): runs the core on the `hermes` VM and prints the report as the engine's
 * canonical JSON (`print(canonicalJson(report))`, ADR-0013 §D4.2; never `JSON.stringify`). Imports only the core
 * entry, so the bundle holds no zod and no report schema. Bundled by `scripts/build-hermes.mjs` with the app's
 * Metro and Babel configuration from `hermes-main.ts`, and compiled with the pinned `hermesc`.
 *
 * The runtime block comes from `HermesInternal.getRuntimeProperties()` (`OSS Release Version`, `Bytecode
 * Version`); the clock is `Date.now()` (integer ms, the only clock of the bare CLI). Neither is compared (§D3.2).
 */
import { canonicalJson, GOLDEN_CORPUS, runGoldens, type CoreRuntime } from '../core/index.js';

/** The VM's own description of itself; absent outside Hermes. */
interface HermesInternalApi {
  readonly getRuntimeProperties?: () => Readonly<Record<string, unknown>>;
}

/** The globals of the bare `hermes` CLI this host uses. */
export interface HermesGlobals {
  readonly print: (text: string) => void;
  readonly HermesInternal?: HermesInternalApi;
}

const VERSION_MAX = 64;

/** `hermes-cli` runtime block from the VM properties; `unknown` / 0 when a property is missing or malformed. */
export function hermesRuntime(
  properties: Readonly<Record<string, unknown>> | undefined,
): CoreRuntime {
  const version = properties?.['OSS Release Version'];
  const bytecode = properties?.['Bytecode Version'];
  return {
    kind: 'hermes-cli',
    version:
      typeof version === 'string' && /^[\x20-\x7e]+$/.test(version) && version.length <= VERSION_MAX
        ? version
        : 'unknown',
    bytecodeVersion:
      typeof bytecode === 'number' && Number.isSafeInteger(bytecode) && bytecode >= 0
        ? bytecode
        : 0,
  };
}

/** Runs the corpus and prints one line of canonical JSON. */
export function runHermesHost(globals: HermesGlobals, clock: () => number): void {
  const report = runGoldens(GOLDEN_CORPUS, {
    runtime: hermesRuntime(globals.HermesInternal?.getRuntimeProperties?.()),
    clock,
  });
  globals.print(canonicalJson(report));
}
