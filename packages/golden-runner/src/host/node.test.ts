import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GOLDEN_CORPUS, type GoldenCorpus } from '../core/index.js';
import { SHA256_PATH } from '../core/corpus.js';
import { COMPARE_USAGE, runCompareCli, runNodeHost, type HostIo } from './node.js';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function capture(): HostIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
}

let nodeText = '';
beforeAll(() => {
  const io = capture();
  expect(runNodeHost(io, { version: 'v22.0.0', clock: () => 0 })).toBe(0);
  nodeText = io.out.join('');
}, 120_000);

describe('Node host (ADR-0016 §D3 item 2)', { timeout: 120_000 }, () => {
  it('prints one line of canonical JSON with verdict pass and exit 0', () => {
    expect(nodeText.endsWith('\n')).toBe(true);
    const report = JSON.parse(nodeText) as { verdict: string; runtime: unknown; timings: object };
    expect(report.verdict).toBe('pass');
    expect(report.runtime).toEqual({ kind: 'node', version: 'v22.0.0' });
    expect(Object.keys(report.timings)).toHaveLength(6);
  });

  it('exits 1 on verdict fail, still printing the report', () => {
    const corpus = JSON.parse(JSON.stringify(GOLDEN_CORPUS)) as Record<
      string,
      { cases: { digest: string }[] }
    >;
    (corpus[SHA256_PATH]?.cases[0] as { digest: string }).digest = 'f'.repeat(64);
    const io = capture();
    expect(runNodeHost(io, { version: 'v22.0.0', corpus: corpus as unknown as GoldenCorpus })).toBe(
      1,
    );
    expect(io.out.join('')).toContain('"verdict":"fail"');
  });

  it('exits 2 without stdout when the report does not parse (a runner bug)', () => {
    const io = capture();
    expect(runNodeHost(io, { version: 'bad\nversion' })).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join('')).toMatch(
      /^golden runner produced an invalid report: \$\.runtime\.version/,
    );
  });
});

describe(
  'compare CLI (ADR-0016 §D3.2), end to end with a synthetic hermes-cli report',
  { timeout: 120_000 },
  () => {
    let dir = '';
    const write = (name: string, text: string): string => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    };
    const hermesFrom = (
      change: (report: Record<string, unknown>) => void = () => undefined,
    ): string => {
      const report = JSON.parse(nodeText) as Record<string, unknown>;
      report['runtime'] = { kind: 'hermes-cli', version: '1.0.0', bytecodeVersion: 98 };
      report['timings'] = { rng: { totalMs: 41 } };
      change(report);
      return JSON.stringify(report);
    };

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'golden-compare-'));
      // turbo runs `build` before `test` for this package (turbo.json); the bins import dist/.
      if (!existsSync(join(pkg, 'dist', 'host', 'node.js'))) {
        throw new Error('dist/ is missing: run `pnpm --filter @codelex/golden-runner build` first');
      }
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const cli = (...args: string[]): { status: number | null; stdout: string; stderr: string } => {
      const run = spawnSync(process.execPath, [join(pkg, 'bin', 'golden-compare.mjs'), ...args], {
        encoding: 'utf8',
      });
      return { status: run.status, stdout: run.stdout, stderr: run.stderr };
    };

    it('equal reports (runtime and timings ignored): exit 0', () => {
      const run = cli(write('node.json', nodeText), write('hermes.json', hermesFrom()));
      expect(run).toMatchObject({ status: 0 });
      expect(run.stdout).toMatch(/^golden reports equal: 6 suites, \d+ cases, verdict pass\n$/);
    });

    it('a differing observed value: exit 1 naming the suite and case with both values', () => {
      const changed = hermesFrom((r) => {
        const suite = (
          r['suites'] as { id: string; cases: { id: string; observed: unknown }[] }[]
        )[1];
        (suite?.cases[1] as { observed: unknown }).observed = '0'.repeat(64);
      });
      const run = cli(write('node.json', nodeText), write('hermes-bad.json', changed));
      expect(run.status).toBe(1);
      expect(run.stdout).toContain('suite "sha256" case "abc"');
      expect(run.stdout).toContain(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('usage and unreadable files: exit 2', () => {
      expect(cli()).toMatchObject({ status: 2, stderr: `${COMPARE_USAGE}\n` });
      expect(cli(join(dir, 'missing.json'), join(dir, 'missing.json')).status).toBe(2);
    });

    it('runCompareCli rejects extra arguments and reports read errors', () => {
      const io = capture();
      expect(runCompareCli(['a', 'b', 'c'], io, () => '')).toBe(2);
      expect(
        runCompareCli(['a', 'b'], io, () => {
          throw new Error('ENOENT');
        }),
      ).toBe(2);
      expect(io.err.join('')).toContain('cannot read report: ENOENT');
    });
  },
);

describe('bin/golden-run.mjs', { timeout: 120_000 }, () => {
  it('prints a passing node report with timings', () => {
    const run = spawnSync(process.execPath, [join(pkg, 'bin', 'golden-run.mjs')], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout) as { verdict: string; runtime: { kind: string } };
    expect(report).toMatchObject({ verdict: 'pass', runtime: { kind: 'node' } });
  });
});
