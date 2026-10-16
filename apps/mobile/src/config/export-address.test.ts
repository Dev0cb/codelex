/** TM-07: the suggested export address cannot be redirected (slice S6c). */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  BUNDLED_EXPORT_ADDRESS,
  EXPORT_ADDRESS_ALLOWLIST,
  isExportAddress,
  resolveExportAddress,
} from './export-address';

const TEAM = 'playtest@codelex.example';
const BACKUP = 'playtest-2@codelex.example';
const ALLOW = [TEAM, BACKUP];

describe('resolveExportAddress (TM-07)', () => {
  it('hides the line while no address is bundled (design O-4)', () => {
    expect(BUNDLED_EXPORT_ADDRESS).toBeNull();
    expect(resolveExportAddress(undefined)).toBeNull();
    expect(resolveExportAddress('attacker@evil.example')).toBeNull();
  });

  it('bundles an address only if it is in the allowlist (fails the build otherwise)', () => {
    const bundled: string | null = BUNDLED_EXPORT_ADDRESS;
    expect(bundled === null || EXPORT_ADDRESS_ALLOWLIST.includes(bundled)).toBe(true);
  });

  it('allowlists only plain email addresses', () => {
    for (const address of EXPORT_ADDRESS_ALLOWLIST) expect(isExportAddress(address)).toBe(true);
    for (const good of [TEAM, BACKUP, 'play.test+s6c@mail.codelex.example']) {
      expect(isExportAddress(good)).toBe(true);
    }
    for (const bad of [
      '',
      'playtest',
      'playtest@',
      '@codelex.example',
      'playtest@codelex',
      'Playtest Team <playtest@codelex.example>',
      'playtest@codelex.example\nBcc: attacker@evil.example',
      'play test@codelex.example',
      'playtest@codelex.example,attacker@evil.example',
      'mailto:playtest@codelex.example',
      'PLAYTEST@CODELEX.EXAMPLE',
      'playtest@-codelex.example',
      'playtest@codelex..example',
    ]) {
      expect(isExportAddress(bad)).toBe(false);
    }
  });

  it('never displays an allowlisted entry that is not a plain email address', () => {
    const bad = 'Team <playtest@codelex.example>';
    expect(resolveExportAddress(undefined, bad, [bad])).toBeNull();
    expect(resolveExportAddress(bad, TEAM, [TEAM, bad])).toBe(TEAM);
  });

  it('shows the bundled address; remote config may hide it or pick an allowlisted one', () => {
    expect(resolveExportAddress(undefined, TEAM, ALLOW)).toBe(TEAM);
    expect(resolveExportAddress(null, TEAM, ALLOW)).toBeNull();
    expect(resolveExportAddress(BACKUP, TEAM, ALLOW)).toBe(BACKUP);
  });

  it('never displays a bundled address outside the allowlist', () => {
    expect(resolveExportAddress(undefined, 'typo@codelex.example', ALLOW)).toBeNull();
  });

  it('property: a remote value outside the allowlist is never displayed', () => {
    fc.assert(
      fc.property(fc.anything(), (remote) => {
        const shown = resolveExportAddress(remote, TEAM, ALLOW);
        expect(shown === null || ALLOW.includes(shown)).toBe(true);
        if (remote !== null && !ALLOW.includes(remote as string)) expect(shown).toBe(TEAM);
      }),
    );
  });
});
