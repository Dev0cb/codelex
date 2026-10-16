/**
 * DG1 note §7 and security condition SC-4: device and Hermes fields picked key by key from an allowlist, bounded
 * printable ASCII; `Fingerprint`, `Serial`, `ServerHost` and other keys never reach the report.
 */
import { describe, expect, it } from '@jest/globals';

import { asciiField, deviceFields, gitShaOf, runtimeCheck } from './device-info';

const ANDROID_CONSTANTS = {
  Manufacturer: 'Samsung',
  Model: 'SM-A256B',
  Release: '14',
  Version: 34,
  Brand: 'samsung',
  Fingerprint: 'samsung/a25xxx/a25:14/UP1A.231005.007/A256BXXU3BXH1:user/release-keys',
  Serial: 'R58W12345AB',
  ServerHost: '10.0.2.2:8081',
  isTesting: false,
};

describe('deviceFields', () => {
  it('picks manufacturer, model, release and API level only on Android', () => {
    const fields = deviceFields('android', ANDROID_CONSTANTS, 34);
    expect(fields).toEqual({
      platform: 'android',
      model: 'Samsung SM-A256B',
      osVersion: 'Android 14 (API 34)',
    });
    const text = JSON.stringify(fields);
    for (const secret of ['R58W12345AB', 'release-keys', '10.0.2.2', 'samsung/']) {
      expect(text).not.toContain(secret);
    }
  });

  it('has no model on iOS and nothing elsewhere', () => {
    expect(deviceFields('ios', { osVersion: '18.1', systemName: 'iOS' }, '18.1')).toEqual({
      platform: 'ios',
      model: 'unknown',
      osVersion: 'iOS 18.1',
    });
    expect(deviceFields('web', {}, 1)).toBeNull();
  });

  it('reduces non-ASCII and over-long values; missing keys become unknown', () => {
    expect(deviceFields('android', { Model: 'Pixel 9 Pro — 5G', Version: 35 }, 35)).toEqual({
      platform: 'android',
      model: 'Pixel 9 Pro ? 5G',
      osVersion: 'Android unknown (API 35)',
    });
    expect(asciiField('x'.repeat(100), 64)).toHaveLength(64);
    expect(asciiField('   ', 10)).toBe('unknown');
    expect(asciiField({ toString: () => 'evil' }, 10)).toBe('unknown');
    expect(deviceFields('android', null, 0)?.model).toBe('unknown');
  });
});

describe('runtimeCheck (note §2 build check)', () => {
  it('is a release Hermes build only without __DEV__ and with HermesInternal', () => {
    const hermes = {
      getRuntimeProperties: () => ({
        'OSS Release Version': '250829098.0.17',
        'Bytecode Version': 98,
        Build: 'Release',
        'Some Path': '/data/app/com.codelex.app',
      }),
    };
    expect(runtimeCheck(hermes, false)).toEqual({
      runtime: { kind: 'hermes-app', version: '250829098.0.17', bytecodeVersion: 98 },
      hermesVersion: '250829098.0.17',
      releaseHermes: true,
    });
    expect(runtimeCheck(hermes, true).releaseHermes).toBe(false);
    expect(runtimeCheck(undefined, false)).toEqual({
      runtime: { kind: 'hermes-app', version: 'unknown', bytecodeVersion: 0 },
      hermesVersion: null,
      releaseHermes: false,
    });
  });

  it('survives malformed or throwing runtime properties', () => {
    const bad = {
      getRuntimeProperties: () => ({ 'OSS Release Version': 'é', 'Bytecode Version': -1 }),
    };
    expect(runtimeCheck(bad, false).runtime).toEqual({
      kind: 'hermes-app',
      version: 'unknown',
      bytecodeVersion: 0,
    });
    const throwing = {
      getRuntimeProperties: () => {
        throw new Error('no');
      },
    };
    expect(runtimeCheck(throwing, false).hermesVersion).toBeNull();
  });
});

describe('gitShaOf (OQ-DG-2, app.config.cjs)', () => {
  it('reads a 40-hex commit from extra.codelexDiagnostics only', () => {
    const sha = 'a'.repeat(40);
    expect(gitShaOf({ codelexDiagnostics: { gitSha: sha } })).toBe(sha);
    expect(gitShaOf({ codelexDiagnostics: { gitSha: 'abc' } })).toBeNull();
    // A local export from a dirty checkout (app.config.cjs S-n2) has no comparable commit.
    expect(gitShaOf({ codelexDiagnostics: { gitSha: `${sha}-dirty` } })).toBeNull();
    expect(gitShaOf({})).toBeNull();
    expect(gitShaOf(undefined)).toBeNull();
  });
});
