import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * The app version (`app.json` `version`): Settings "About this build" and every analytics event's `app_version`.
 * `0.0.0` if the embedded config has none: it still matches the event schema, so the readout sees an impossible
 * version instead of losing every event.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/**
 * The store build number for an export file's `app.build` (D1 `ExportAppSchema`, TM-04 R-1): `android.versionCode` or
 * `ios.buildNumber` from the embedded config. Unset means the prebuild default, `1` (`eas.json` uses
 * `appVersionSource: local`). A value that is not 1–10 digits becomes `0`, which the schema accepts and no build has.
 */
export function buildNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return '1';
  const text = String(value);
  return /^\d{1,10}$/.test(text) ? text : '0';
}

export const APP_BUILD: string = buildNumber(
  Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode,
);

/** An export platform (D1 `ExportAppSchema`): `ios` or `android`; null elsewhere (web, tests of other targets). */
export function exportPlatform(os: string): 'ios' | 'android' | null {
  return os === 'ios' || os === 'android' ? os : null;
}

/**
 * The exporting build of a "Send match log" file (`app`, TM-04: version, store build, platform, nothing finer); null
 * on a platform that is neither iOS nor Android, where nothing is exported.
 */
export function exportApp(os: string = Platform.OS): {
  readonly version: string;
  readonly build: string;
  readonly platform: 'ios' | 'android';
} | null {
  const platform = exportPlatform(os);
  return platform === null ? null : { version: APP_VERSION, build: APP_BUILD, platform };
}
