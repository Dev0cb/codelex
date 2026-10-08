import Constants from 'expo-constants';

/**
 * The app version (`app.json` `version`): Settings "About this build" and every analytics event's `app_version`.
 * `0.0.0` if the embedded config has none: it still matches the event schema, so the readout sees an impossible
 * version instead of losing every event.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';
