/**
 * Bundle budget (slice S6a): zod costs ≈ +555 KB of Hermes bytecode per platform (Metro bundles its CommonJS build
 * whole), so app code never imports it at runtime. The D1 zod modules (`analytics/events.ts`, `export/*`) stay for
 * Node and tests; app modules reach them only with `import type`, and validate on device with `event-guard.ts`.
 */
import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
/** Modules that may import zod: Node-side contracts, never imported at runtime by the app. */
const ZOD_MODULES = new Set([
  'analytics/events.ts',
  'export/common.ts',
  'export/match-log.ts',
  'export/playtest-data.ts',
]);
const TEST_ONLY = /(\.test\.tsx?|test-support\.ts|test-analytics\.ts|memory-fs\.ts)$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const IMPORT = /^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gms;

describe('no zod in the app bundle', () => {
  it('imports zod, events.ts and export/* only from Node-side modules or as types', () => {
    const offenders: string[] = [];
    let typeImportsOfEvents = 0;
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (!/\.tsx?$/.test(rel) || TEST_ONLY.test(rel) || ZOD_MODULES.has(rel)) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const typeOnly = match[1] !== undefined;
        const source = match[2] ?? '';
        if (typeOnly && /(^|\/)events(\.ts)?$/.test(source)) typeImportsOfEvents += 1;
        const runtimeContract =
          /(^|\/)events(\.ts)?$/.test(source) || /(^|\/)export\//.test(source);
        if (source.startsWith('zod') || (!typeOnly && runtimeContract))
          offenders.push(`${rel} → ${source}`);
      }
    }
    expect(offenders).toEqual([]);
    // Non-vacuous: the scan sees the app's type-only imports of the event contracts.
    expect(typeImportsOfEvents).toBeGreaterThan(2);
  });
});
