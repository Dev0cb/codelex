/** TM-07: the suggested export address cannot be redirected (slice S6c). */
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import {
  BUNDLED_EXPORT_ADDRESS,
  EXPORT_ADDRESS_ALLOWLIST,
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
    // The bundled constant is always in the allowlist.
    if (BUNDLED_EXPORT_ADDRESS !== null) {
      expect(EXPORT_ADDRESS_ALLOWLIST).toContain(BUNDLED_EXPORT_ADDRESS);
    }
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
