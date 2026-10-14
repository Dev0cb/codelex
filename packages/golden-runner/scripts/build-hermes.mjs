#!/usr/bin/env node
/**
 * Hermes CLI bundle (ADR-0016 §D3 item 4): bundles `dist/host/hermes-main.js` (the core + corpus, no zod) with the
 * app's own Metro and Babel configuration and compiles it with the pinned `hermesc`, using release flags.
 *
 * - Bundle: `expo export:embed` run from `apps/mobile` (its `metro.config.cjs`, `babel-preset-expo`), the command
 *   the Android release build (React Native Gradle plugin, Expo template) runs: `--platform android --dev false
 *   --minify true --reset-cache`. Only the entry file differs from the app.
 * - Compile: the `hermesc` of the `hermes-compiler` package that `react-native` (as resolved from `apps/mobile`)
 *   depends on, with the Gradle `BundleHermesCTask` release command line:
 *   `-w -emit-binary -max-diagnostic-width=80 -out <hbc> <js> -O -output-source-map` (`expo export` uses the same
 *   `-emit-binary … -O -output-source-map`).
 * - Guard: the bundle's source map must list no `zod` module and no report schema (README P3 note).
 *
 * Usage: `node scripts/build-hermes.mjs [--out <dir>]` after `pnpm turbo run build --filter=@codelex/golden-runner`.
 * Writes `<out>/runner.js`, `<out>/runner.js.map`, `<out>/runner.hbc`, `<out>/runner.hbc.map` and prints the
 * `hermesc` bytecode version. Run: `<hermes> <out>/runner.hbc > hermes.json`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const repo = resolve(pkg, '..', '..');
const mobile = join(repo, 'apps', 'mobile');

export const HERMESC_RELEASE_FLAGS = ['-w', '-emit-binary', '-max-diagnostic-width=80'];
export const HERMESC_OPT_FLAGS = ['-O', '-output-source-map'];

/** `hermesc` of the `hermes-compiler` that `react-native` resolves to from `apps/mobile`. */
export function pinnedHermesc() {
  const fromMobile = createRequire(join(mobile, 'package.json'));
  const fromRn = createRequire(fromMobile.resolve('react-native/package.json'));
  const root = dirname(fromRn.resolve('hermes-compiler/package.json'));
  const bin = {
    linux: 'linux64-bin/hermesc',
    darwin: 'osx-bin/hermesc',
    win32: 'win64-bin/hermesc.exe',
  }[process.platform];
  if (bin === undefined) throw new Error(`no pinned hermesc for ${process.platform}`);
  return join(root, 'hermesc', bin);
}

function outDir(argv) {
  const i = argv.indexOf('--out');
  return resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : join(pkg, '.hermes-out'));
}

function main() {
  const out = outDir(process.argv.slice(2));
  const entry = join(pkg, 'dist', 'host', 'hermes-main.js');
  if (!existsSync(entry)) throw new Error(`${entry} missing: build @codelex/golden-runner first`);
  mkdirSync(out, { recursive: true });
  const js = join(out, 'runner.js');
  const hbc = join(out, 'runner.hbc');

  execFileSync(
    process.execPath,
    [
      join(mobile, 'node_modules', 'expo', 'bin', 'cli'),
      'export:embed',
      '--platform',
      'android',
      '--dev',
      'false',
      '--reset-cache',
      '--entry-file',
      entry,
      '--bundle-output',
      js,
      '--sourcemap-output',
      `${js}.map`,
      '--assets-dest',
      join(out, 'assets'),
      '--minify',
      'true',
    ],
    { cwd: mobile, stdio: 'inherit', env: { ...process.env, CI: '1' } },
  );

  const sources = JSON.parse(readFileSync(`${js}.map`, 'utf8')).sources ?? [];
  // Core only: from this package, dist/core/** and the Hermes host; nothing from zod.
  const leaked = sources.filter(
    (s) => /packages\/golden-runner\/dist\/(?!core\/|host\/hermes)/.test(s) || /\/zod\//.test(s),
  );
  if (leaked.length > 0)
    throw new Error(`Hermes bundle must hold the core only, found: ${leaked.join(', ')}`);

  const hermesc = pinnedHermesc();
  execFileSync(hermesc, [...HERMESC_RELEASE_FLAGS, '-out', hbc, js, ...HERMESC_OPT_FLAGS], {
    stdio: 'inherit',
  });
  const version = execFileSync(hermesc, ['-version'], { encoding: 'utf8' }).match(
    /HBC bytecode version: (\d+)/,
  );
  process.stdout.write(
    `golden runner bundle: ${hbc} (hermesc ${hermesc}, bytecode ${version?.[1] ?? 'unknown'}, ${String(sources.length)} modules)\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
