/**
 * Device, build and runtime fields of the Diagnostics report (DG1 note §7; security review SC-4). Only in preview
 * builds: this module is in `src/diagnostics/`, which the production bundle does not contain, and
 * `Platform.constants` is linted out of every other module. Every field is **picked key by key** from an allowlist
 * and reduced to bounded printable ASCII; nothing is spread. Never: `Fingerprint`, `Serial`, `ServerHost`, install
 * id, timestamps, paths, user names.
 */
import type { CoreRuntime } from '@codelex/golden-runner/core';

/** Printable ASCII of at most `max` chars (other chars become `?`); `unknown` when nothing is left. */
export function asciiField(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'unknown';
  const text = String(value)
    .replace(/[^\x20-\x7e]/g, '?')
    .trim()
    .slice(0, max)
    .trim();
  return text === '' ? 'unknown' : text;
}

const field = (source: unknown, key: string): unknown =>
  typeof source === 'object' && source !== null && Object.hasOwn(source, key)
    ? (source as Readonly<Record<string, unknown>>)[key]
    : undefined;

export interface DeviceFields {
  readonly platform: 'android' | 'ios';
  readonly model: string;
  readonly osVersion: string;
}

/** A2 bounds: `model` ≤ 64, `osVersion` ≤ 32. */
const MODEL_MAX = 64;
const OS_MAX = 32;

/**
 * The device block from `Platform.OS`, `Platform.constants` and `Platform.Version`. Android: `Manufacturer` +
 * `Model`, `Release` and `Version` (API level). iOS: `Platform.constants` has no model and no dependency is added
 * for one (note §7), so the model is `unknown`. Null on any other platform.
 */
export function deviceFields(
  os: string,
  constants: unknown,
  version: unknown,
): DeviceFields | null {
  if (os === 'android') {
    const maker = asciiField(field(constants, 'Manufacturer'), MODEL_MAX);
    const model = asciiField(field(constants, 'Model'), MODEL_MAX);
    const release = asciiField(field(constants, 'Release'), 12);
    const api = asciiField(field(constants, 'Version'), 6);
    return {
      platform: 'android',
      model: asciiField(`${maker === 'unknown' ? '' : maker} ${model}`, MODEL_MAX),
      osVersion: asciiField(`Android ${release} (API ${api})`, OS_MAX),
    };
  }
  if (os === 'ios') {
    return {
      platform: 'ios',
      model: 'unknown',
      osVersion: asciiField(`iOS ${asciiField(version, 20)}`, OS_MAX),
    };
  }
  return null;
}

/** The VM's description of itself, as far as the report uses it. */
interface HermesInternalLike {
  readonly getRuntimeProperties?: () => unknown;
}

export interface RuntimeCheck {
  /** `hermes-app` runtime block of the runner report (not compared, ADR-0016 §D3.2). */
  readonly runtime: CoreRuntime;
  /** The Hermes `OSS Release Version`, for the build banner; null outside Hermes. */
  readonly hermesVersion: string | null;
  /**
   * True on a release build running Hermes bytecode (note §2): `__DEV__` false and `HermesInternal` present.
   * Otherwise timings are not valid and the report says so (timed benches `not-measured`).
   */
  readonly releaseHermes: boolean;
}

/**
 * Picks `OSS Release Version` and `Bytecode Version` from `HermesInternal.getRuntimeProperties()`; other keys are
 * never read (SC-4).
 */
export function runtimeCheck(hermes: HermesInternalLike | undefined, dev: boolean): RuntimeCheck {
  let properties: unknown;
  try {
    properties = hermes?.getRuntimeProperties?.();
  } catch {
    properties = undefined;
  }
  const version = field(properties, 'OSS Release Version');
  const bytecode = field(properties, 'Bytecode Version');
  const hermesVersion =
    typeof version === 'string' && /^[\x20-\x7e]{1,64}$/.test(version) ? version : null;
  return {
    runtime: {
      kind: 'hermes-app',
      version: hermesVersion ?? 'unknown',
      bytecodeVersion:
        typeof bytecode === 'number' && Number.isSafeInteger(bytecode) && bytecode >= 0
          ? bytecode
          : 0,
    },
    hermesVersion,
    releaseHermes: !dev && hermes !== undefined,
  };
}

const GIT_SHA = /^[0-9a-f]{40}$/;

/**
 * The commit of a `preview-diagnostics` build: `extra.codelexDiagnostics.gitSha`, written by `app.config.cjs` only
 * when `EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1` (OQ-DG-2). Null when absent or malformed: then no report can be built,
 * because the comparison needs the commit of the Node report.
 */
export function gitShaOf(extra: unknown): string | null {
  const sha = field(field(extra, 'codelexDiagnostics'), 'gitSha');
  return typeof sha === 'string' && GIT_SHA.test(sha) ? sha : null;
}
