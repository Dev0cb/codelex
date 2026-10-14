/**
 * Threat model TM-03 / R1-4: on the device, the install id, the analytics queue, the consent choice and the session
 * marker are written under the backup-excluded data directory (`DATA_DIR`) and nowhere else. Runs the device
 * bindings on the Node stand-in of expo-file-system (a real temporary directory per test file).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Paths } from 'expo-file-system';

import { DATA_DIR } from '../persistence/device-fs';
import { CONSENT_FILE } from './consent';
import { createDeviceAnalyticsPlatform, deviceAnalytics } from './device-analytics';
import { QUEUE_FILE, QUEUE_META_FILE } from './event-queue';
import { INSTALL_ID_FILE, isUuidV4 } from './install-id';
import { SESSION_MARKER_FILE } from './session-marker';

jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'fr-SN-u-fw-mon' }],
}));

describe('device analytics storage (TM-03, R1-4)', () => {
  it('writes every analytics file under DATA_DIR and nothing outside it', () => {
    const analytics = deviceAnalytics(true);
    expect(deviceAnalytics(false)).toBe(analytics);
    analytics.start();
    analytics.onAppState('active');
    analytics.load();
    analytics.markInteractive();
    analytics.markNoticeSeen();
    analytics.record('app_backgrounded', { foreground_ms: -1 });
    const root = Paths.document.uri;
    expect(readdirSync(root)).toEqual([DATA_DIR]);
    expect(readdirSync(join(root, DATA_DIR)).sort()).toEqual(
      [CONSENT_FILE, INSTALL_ID_FILE, QUEUE_FILE, QUEUE_META_FILE, SESSION_MARKER_FILE].sort(),
    );
    expect(isUuidV4(analytics.getSnapshot().installId ?? '')).toBe(true);
    expect(analytics.queuedCount()).toBe(1);
  });

  it('fills the envelope from the build and the device locale, without extensions', () => {
    const platform = createDeviceAnalyticsPlatform();
    expect(platform.context()).toEqual({
      app_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      platform: expect.stringMatching(/^(ios|android)$/),
      locale: 'fr-SN',
    });
    expect(isUuidV4(platform.randomUUID())).toBe(true);
    const mono = platform.monoMs();
    expect(platform.monoMs()).toBeGreaterThanOrEqual(mono);
    expect(platform.sinceProcessStartMs()).toBeGreaterThanOrEqual(0);
    expect(Math.abs(platform.wallMs() - Date.now())).toBeLessThan(1000);
  });
});
