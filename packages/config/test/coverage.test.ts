import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Coverage-floor integration: runs the real `vitest run --coverage` in a scratch package (consumer
 * layout, config loaded from the built `dist/`) and asserts exit codes and threshold errors.
 */
const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, '..', 'dist', 'vitest', 'index.js');
const workspaceNodeModules = resolve(here, '..', '..', '..', 'node_modules');
const vitestBin = resolve(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

let root = '';

function writeConfig(pkg: string, body: string): void {
  writeFileSync(
    join(root, pkg, 'vitest.config.ts'),
    `import { basePreset, strictPreset, defineCodelexVitest } from ${JSON.stringify(
      pathToFileURL(distEntry).href,
    )};\nvoid basePreset;\nvoid strictPreset;\nexport default ${body};\n`,
  );
}

function run(pkg: string): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries({ ...process.env, CI: '1' }).filter(
      ([key]) => !key.startsWith('VITEST') && key !== 'NODE_V8_COVERAGE',
    ),
  );
  const r = spawnSync(process.execPath, [vitestBin, 'run', '--coverage'], {
    cwd: join(root, pkg),
    env,
    encoding: 'utf8',
    timeout: 90_000,
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '') };
}

beforeAll(() => {
  if (!existsSync(distEntry)) {
    throw new Error(`${distEntry} is missing: run \`pnpm --filter @codelex/config build\` first`);
  }
  root = mkdtempSync(join(tmpdir(), 'codelex-config-cov-'));
  cpSync(resolve(here, 'fixtures', 'coverage-pkgs'), root, { recursive: true });
  symlinkSync(workspaceNodeModules, join(root, 'node_modules'), 'dir');
  for (const pkg of ['under', 'full']) {
    symlinkSync(join(root, 'node_modules'), join(root, pkg, 'node_modules'), 'dir');
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('coverage floor (real vitest run)', () => {
  it('an under-covered package FAILS with basePreset', () => {
    writeConfig('under', 'defineCodelexVitest(basePreset)');
    const { status, output } = run('under');
    expect(status).not.toBe(0);
    expect(output).toMatch(/coverage for (lines|functions|statements|branches).*does not meet/i);
  });

  it('an under-covered package FAILS with strictPreset', () => {
    writeConfig('under', 'defineCodelexVitest(strictPreset)');
    const { status, output } = run('under');
    expect(status).not.toBe(0);
    expect(output).toMatch(/does not meet global threshold \(90%\)/i);
  });

  it('a fully covered package PASSES with strictPreset', () => {
    writeConfig('full', 'defineCodelexVitest(strictPreset)');
    const { status, output } = run('full');
    expect(output).toContain('Coverage summary');
    expect(status).toBe(0);
  });

  it('an override that lowers a threshold fails at config load (non-zero exit)', () => {
    writeConfig(
      'under',
      'defineCodelexVitest(strictPreset, { test: { coverage: { thresholds: { lines: 10 } } } })',
    );
    const { status, output } = run('under');
    expect(status).not.toBe(0);
    expect(output).toMatch(/may not be lowered/);
  });

  it('an override hiding src from coverage fails at config load (non-zero exit)', () => {
    writeConfig(
      'under',
      "defineCodelexVitest(strictPreset, { test: { coverage: { exclude: ['src/**'] } } })",
    );
    const { status, output } = run('under');
    expect(status).not.toBe(0);
    expect(output).toMatch(/coverage\.exclude/);
  });
});
