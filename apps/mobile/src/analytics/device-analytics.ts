/**
 * The recorder's platform on the device: the backup-excluded data directory (`DATA_DIR`, TM-03, R1-4), expo-crypto's
 * CSPRNG UUIDs, the device and monotonic clocks, and the envelope context (app version, platform, locale). No new
 * dependency: expo-crypto, expo-constants and expo-localization are already in the app.
 */
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';

import { APP_VERSION } from '../config/build-info';
import { createDeviceFs } from '../persistence/device-fs';
import { createDeviceShare } from '../sharing/device-share';
import { sweepShareDirectory } from '../sharing/share-file';
import { normalizeLocale } from './envelope';
import { PlaytestAnalytics, type AnalyticsPlatform } from './recorder';

/** React Native's `performance` (not in the TS lib for RN): `now()` and the non-standard startup timing. */
interface RnPerformance {
  now(): number;
  readonly rnStartupTiming?: { readonly startTime?: number | null };
}

const perf = (globalThis as { performance?: RnPerformance }).performance;

// React Native always installs `performance` (Hermes, RN 0.86), so the wall-clock branch is unreachable on devices;
// it only keeps the module loadable where the global is missing (it would make foreground_ms wall-clock based).
const monoMs = (): number => (perf === undefined ? Date.now() : perf.now());

/**
 * `cold_start_ms`: native process start → now when RN reports a start time on the same clock; otherwise the time
 * since the JS runtime's time origin (a lower bound). To be checked on a device in H1.
 */
function sinceProcessStartMs(): number {
  const now = monoMs();
  let start: number | null | undefined;
  try {
    start = perf?.rnStartupTiming?.startTime;
  } catch {
    start = undefined;
  }
  return typeof start === 'number' && Number.isFinite(start) && start >= 0 && start <= now
    ? now - start
    : now;
}

export function createDeviceAnalyticsPlatform(): AnalyticsPlatform {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  return {
    fs: createDeviceFs(),
    randomUUID,
    wallMs: () => Date.now(),
    monoMs,
    sinceProcessStartMs,
    context: () => ({
      app_version: APP_VERSION,
      platform,
      locale: normalizeLocale(getLocales().at(0)?.languageTag),
    }),
    sweepShareDirectory: () => {
      sweepShareDirectory(createDeviceShare().directory);
    },
  };
}

let device: PlaytestAnalytics | undefined;

/** One recorder per process (the session marker and `session_id` are per process). */
export function deviceAnalytics(enabled: boolean): PlaytestAnalytics {
  device ??= new PlaytestAnalytics(createDeviceAnalyticsPlatform(), enabled);
  return device;
}
