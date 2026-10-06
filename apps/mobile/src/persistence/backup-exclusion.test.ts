/**
 * TM-03 config test (threat model e-1.5-s1-persistence-match-log §7): app data never goes to an OS backup. Asserts
 * the Android setting in app.json, the plugin wiring, and what the plugin writes into the native projects. The
 * on-device check (an `adb` backup and an iCloud backup hold no app data) is a manual release-checklist item.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const requireCjs = createRequire(__filename);

interface Plugin {
  readonly DATA_EXTRACTION_RULES_XML: string;
  applyAndroidBackupRules(manifest: unknown): {
    manifest: { application: { $: Record<string, string> }[] };
  };
  applyIosBackupExclusion(source: string): string;
}
const plugin = requireCjs('../../plugins/with-backup-exclusion.cjs') as Plugin;
const appJson = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8')) as {
  expo: { android: Record<string, unknown>; plugins: unknown[] };
};

/** The didFinishLaunching part of the Expo SDK 57 template AppDelegate.swift. */
const TEMPLATE_APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('backups exclude app data (TM-03)', () => {
  it('turns Android backup off in app.json and registers the plugin', () => {
    expect(appJson.expo.android['allowBackup']).toBe(false);
    expect(appJson.expo.plugins).toContain('./plugins/with-backup-exclusion.cjs');
  });

  it('excludes every domain from Android cloud backup and device transfer', () => {
    const manifest = plugin.applyAndroidBackupRules({
      manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
    });
    expect(manifest.manifest.application[0]?.$).toMatchObject({
      'android:name': '.MainApplication',
      'android:allowBackup': 'false',
      'android:fullBackupContent': 'false',
      'android:dataExtractionRules': '@xml/codelex_data_extraction_rules',
    });
    const xml = plugin.DATA_EXTRACTION_RULES_XML;
    for (const section of ['cloud-backup', 'device-transfer']) {
      const body = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? '';
      for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
        expect(body).toContain(`<exclude domain="${domain}" path="." />`);
      }
      expect(body).not.toContain('<include');
    }
    expect(() => plugin.applyAndroidBackupRules({ manifest: {} })).toThrow();
  });

  it('marks the iOS data directory excluded from backup at launch, once', () => {
    const patched = plugin.applyIosBackupExclusion(TEMPLATE_APP_DELEGATE);
    expect(patched).toContain('import Foundation');
    expect(patched).toContain('values.isExcludedFromBackup = true');
    expect(patched).toContain('"codelex-data"');
    const launch = patched.indexOf('-> Bool {');
    const call = patched.indexOf('CodelexBackupExclusion.apply()');
    expect(call).toBeGreaterThan(launch);
    expect(call).toBeLessThan(patched.indexOf('let delegate'));
    expect(plugin.applyIosBackupExclusion(patched)).toBe(patched);
    expect(() => plugin.applyIosBackupExclusion('class AppDelegate {}')).toThrow();
  });
});
