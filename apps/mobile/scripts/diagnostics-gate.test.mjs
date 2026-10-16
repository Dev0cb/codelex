// DG1 (docs/architecture/notes/diagnostics-screen.md): the bundle proof functions (§3.3, DG1-b, SC-3), the EAS
// profile scoping (§2, §10 check 2, SC-5), the app.config commit step (OQ-DG-2) and the lint restatement (SC-2).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import {
  checkPreviewOnlyAbsent,
  checkPreviewOnlyPresent,
  checkProductionConfig,
  markersIn,
  readExportBundles,
  sourcesMatching,
} from './bundle-contents.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const previewOnly = JSON.parse(readFileSync(join(appDir, 'bundle-preview-only.json'), 'utf8'));
const bytes = (text) => new Uint8Array(Buffer.from(text, 'latin1'));

const CLEAN_SOURCES = [
  '/node_modules/.pnpm/react@19.2.3/node_modules/react/index.js',
  '/apps/mobile/src/features/settings/settings-screen.tsx',
  '/packages/game-engine/dist/index.js',
];
const clean = () => ({
  sources: [...CLEAN_SOURCES],
  bytes: bytes('\u0000hbc settings.about.versions'),
});

test('the preview-only list names the diagnostics module, the runner, the goldens and the markers', () => {
  assert.deepEqual(previewOnly.markers, [
    'CODELEX_DIAGNOSTICS_SCREEN_V1',
    'CODELEX_GOLDEN_RUNNER_V1',
    'codelex-diagnostics.json',
  ]);
  for (const p of [
    'apps/mobile/src/diagnostics/',
    'packages/golden-runner/',
    'packages/game-engine/test/golden/',
  ]) {
    assert.ok(previewOnly.modulePathPatterns.includes(p), p);
  }
});

test('sourcesMatching normalises separators; markersIn finds ASCII bytes', () => {
  assert.deepEqual(
    sourcesMatching(
      ['C:\\r\\apps\\mobile\\src\\diagnostics\\entry.tsx'],
      ['apps/mobile/src/diagnostics/'],
    ),
    ['C:\\r\\apps\\mobile\\src\\diagnostics\\entry.tsx'],
  );
  assert.deepEqual(markersIn(bytes('xxCODELEX_GOLDEN_RUNNER_V1yy'), previewOnly.markers), [
    'CODELEX_GOLDEN_RUNNER_V1',
  ]);
  assert.deepEqual(markersIn(bytes('CODELEX_GOLDEN_RUNNER_'), previewOnly.markers), []);
});

test('absence check: a clean production export passes on android and ios', () => {
  const result = checkPreviewOnlyAbsent({ android: clean(), ios: clean() }, previewOnly, [
    'android',
    'ios',
  ]);
  assert.equal(result.ok, true, result.lines.join('\n'));
});

test('absence check: each module pattern fails (an unguarded import of src/diagnostics/entry, SC-3)', () => {
  for (const pattern of previewOnly.modulePathPatterns) {
    const tainted = { ...clean(), sources: [...CLEAN_SOURCES, `/${pattern}entry.tsx`] };
    const result = checkPreviewOnlyAbsent({ android: clean(), ios: tainted }, previewOnly, [
      'android',
      'ios',
    ]);
    assert.equal(result.ok, false, pattern);
    assert.match(result.lines.join('\n'), /FAIL ios: preview-only module/);
  }
});

test('absence check: each marker in the bundle bytes fails', () => {
  for (const marker of previewOnly.markers) {
    const tainted = { ...clean(), bytes: bytes(`abc${marker}def`) };
    const result = checkPreviewOnlyAbsent({ android: tainted, ios: clean() }, previewOnly, [
      'android',
      'ios',
    ]);
    assert.equal(result.ok, false, marker);
    assert.match(
      result.lines.join('\n'),
      new RegExp(`FAIL android: preview-only marker ${marker}`),
    );
  }
});

test('absence check fails closed: missing map, missing bundle, missing platform, empty list', () => {
  const missing = [
    { android: { ...clean(), sources: null }, ios: clean() },
    { android: { ...clean(), bytes: null }, ios: clean() },
    { android: clean() },
  ];
  for (const bundles of missing) {
    assert.equal(checkPreviewOnlyAbsent(bundles, previewOnly, ['android', 'ios']).ok, false);
  }
  const empty = { modulePathPatterns: [], markers: previewOnly.markers };
  assert.equal(
    checkPreviewOnlyAbsent({ android: clean(), ios: clean() }, empty, ['android', 'ios']).ok,
    false,
  );
});

test('positive control requires a diagnostics module, a runner module and both markers', () => {
  const full = {
    sources: [
      ...CLEAN_SOURCES,
      '/apps/mobile/src/diagnostics/entry.tsx',
      '/packages/golden-runner/dist/core/run.js',
    ],
    bytes: bytes(previewOnly.markers.join(' ')),
  };
  assert.equal(checkPreviewOnlyPresent(full, previewOnly, 'android').ok, true);
  assert.equal(checkPreviewOnlyPresent(clean(), previewOnly, 'android').ok, false);
  assert.equal(
    checkPreviewOnlyPresent(
      { ...full, bytes: bytes(previewOnly.markers[0]) },
      previewOnly,
      'android',
    ).ok,
    false,
  );
  assert.equal(
    checkPreviewOnlyPresent({ ...full, sources: full.sources.slice(0, -1) }, previewOnly, 'android')
      .ok,
    false,
  );
  assert.equal(checkPreviewOnlyPresent(undefined, previewOnly, 'android').ok, false);
});

/** An `expo export` directory: metadata.json naming the main bundle, plus `extra` files beside it. */
function exportDir(platformFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'codelex-dg-export-'));
  const fileMetadata = {};
  for (const [platform, files] of Object.entries(platformFiles)) {
    const jsDir = join(dir, '_expo', 'static', 'js', platform);
    mkdirSync(jsDir, { recursive: true });
    fileMetadata[platform] = { bundle: `_expo/static/js/${platform}/index-1.hbc`, assets: [] };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(jsDir, name)), { recursive: true });
      writeFileSync(join(jsDir, name), text);
    }
  }
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ version: 0, fileMetadata }));
  return dir;
}
const map = (...sources) => JSON.stringify({ version: 3, sources, mappings: '' });

test('readExportBundles scans every file of the platform directory, maps included (S-m1)', () => {
  const dir = exportDir({
    android: {
      'index-1.hbc': 'main bytes',
      'index-1.hbc.map': map('/apps/mobile/src/app.tsx'),
      'chunk-2.hbc': 'xxCODELEX_DIAGNOSTICS_SCREEN_V1',
      'chunk-2.hbc.map': map('/apps/mobile/src/diagnostics/entry.tsx'),
      'nested/extra.js': 'codelex-diagnostics.json',
    },
    ios: {
      'index-1.hbc': 'ios bytes',
      'index-1.hbc.map': JSON.stringify({
        version: 3,
        sources: ['/apps/mobile/src/app.tsx'],
        sourcesContent: ['const marker = "CODELEX_GOLDEN_RUNNER_V1";'],
        mappings: '',
      }),
    },
  });
  try {
    const bundles = readExportBundles(dir);
    assert.equal(bundles.android.bundleSize, 'main bytes'.length);
    assert.equal(bundles.android.files, 5);
    assert.deepEqual([...(bundles.android.sources ?? [])].sort(), [
      '/apps/mobile/src/app.tsx',
      '/apps/mobile/src/diagnostics/entry.tsx',
    ]);
    const result = checkPreviewOnlyAbsent(bundles, previewOnly, ['android', 'ios']);
    assert.equal(result.ok, false);
    const text = result.lines.join('\n');
    assert.match(
      text,
      /FAIL android: preview-only module \/apps\/mobile\/src\/diagnostics\/entry\.tsx/,
    );
    assert.match(text, /FAIL android: preview-only marker CODELEX_DIAGNOSTICS_SCREEN_V1/);
    assert.match(text, /FAIL android: preview-only marker codelex-diagnostics\.json/);
    // A marker only in a source map's sourcesContent is found too.
    assert.match(text, /FAIL ios: preview-only marker CODELEX_GOLDEN_RUNNER_V1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readExportBundles fails closed: missing main bundle or map, unreadable map, missing directory', () => {
  const cases = [
    { android: { 'index-1.hbc.map': map('/a.ts') } },
    { android: { 'index-1.hbc': 'x' } },
    { android: { 'index-1.hbc': 'x', 'index-1.hbc.map': map('/a.ts'), 'c.hbc.map': '{not json' } },
  ];
  for (const files of cases) {
    const dir = exportDir(files);
    try {
      const result = checkPreviewOnlyAbsent(readExportBundles(dir), previewOnly, ['android']);
      assert.equal(result.ok, false, JSON.stringify(Object.keys(files.android)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const clean = exportDir({ android: { 'index-1.hbc': 'x', 'index-1.hbc.map': map('/a.ts') } });
  try {
    assert.equal(
      checkPreviewOnlyAbsent(readExportBundles(clean), previewOnly, ['android']).ok,
      true,
    );
    rmSync(join(clean, '_expo'), { recursive: true, force: true });
    assert.equal(
      checkPreviewOnlyAbsent(readExportBundles(clean), previewOnly, ['android']).ok,
      false,
    );
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
});

test('checkProductionConfig: the production expo config has no diagnostics extra or id (S-m1)', () => {
  const { expo } = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
  assert.equal(checkProductionConfig(JSON.stringify(expo)).ok, true);
  const appConfig = require('../app.config.cjs');
  const diagnostics = appConfig(
    { config: expo },
    { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1' },
    () => 'abcdef0123456789abcdef0123456789abcdef01',
    () => '',
  );
  const result = checkProductionConfig(JSON.stringify(diagnostics));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /extra\.codelexDiagnostics/);
  assert.match(result.lines.join('\n'), /com\.codelex\.app\.diagnostics/);
  assert.equal(
    checkProductionConfig(
      JSON.stringify({ ...expo, extra: { ...expo.extra, codelexDiagnostics: {} } }),
    ).ok,
    false,
  );
  for (const broken of ['', 'not json', '[]', 'null']) {
    assert.equal(checkProductionConfig(broken).ok, false, broken);
  }
});

test('only preview-diagnostics sets the constant; it differs from preview by that variable only (§10.2, SC-5)', () => {
  const eas = JSON.parse(readFileSync(join(appDir, 'eas.json'), 'utf8'));
  const profiles = eas.build;
  for (const [name, profile] of Object.entries(profiles)) {
    const has = Object.hasOwn(profile.env ?? {}, 'EXPO_PUBLIC_CODELEX_DIAGNOSTICS');
    assert.equal(has, name === 'preview-diagnostics', name);
  }
  const diagnostics = profiles['preview-diagnostics'];
  assert.equal(diagnostics.extends, 'preview');
  assert.deepEqual(Object.keys(diagnostics).sort(), ['env', 'extends']);
  const { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: constant, ...rest } = diagnostics.env;
  assert.equal(constant, '1');
  assert.deepEqual(rest, profiles.preview.env);
  // Inherited release settings: internal distribution, no dev client, no Debug build, no channel, never submitted.
  const preview = profiles.preview;
  assert.equal(preview.distribution, 'internal');
  for (const key of ['developmentClient', 'gradleCommand', 'buildConfiguration', 'channel']) {
    assert.equal(Object.hasOwn(preview, key) || Object.hasOwn(diagnostics, key), false, key);
  }
  assert.equal(Object.hasOwn(preview.ios ?? {}, 'buildConfiguration'), false);
  assert.equal(Object.hasOwn(preview.android ?? {}, 'gradleCommand'), false);
  assert.equal(Object.hasOwn(eas.submit ?? {}, 'preview-diagnostics'), false);
});

test('app.config.cjs: app.json unchanged without the constant; the commit with it, fail closed', () => {
  const appConfig = require('../app.config.cjs');
  const { expo } = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
  assert.equal(appConfig({ config: expo }, {}), expo);
  assert.equal(appConfig({ config: expo }, { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '0' }), expo);
  assert.equal(appConfig({ config: expo }, { EAS_BUILD_PROFILE: 'preview' }), expo);
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const clean = () => '';
  const eas = appConfig(
    { config: expo },
    {
      EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1',
      EAS_BUILD_PROFILE: 'preview-diagnostics',
      EAS_BUILD_GIT_COMMIT_HASH: sha,
    },
  );
  assert.deepEqual(eas.extra, { ...expo.extra, codelexDiagnostics: { gitSha: sha } });
  const local = appConfig(
    { config: expo },
    { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1' },
    () => `${sha.toUpperCase()}\n`,
    clean,
  );
  assert.equal(local.extra.codelexDiagnostics.gitSha, sha);
  assert.throws(() =>
    appConfig({ config: expo }, { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1' }, () => 'nope', clean),
  );
  assert.throws(() =>
    appConfig(
      { config: expo },
      { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1' },
      () => {
        throw new Error('no git');
      },
      clean,
    ),
  );
});

test('app.config.cjs SC-6: the constant only in a local export or preview-diagnostics, and vice versa', () => {
  const appConfig = require('../app.config.cjs');
  const { expo } = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const on = { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1', EAS_BUILD_GIT_COMMIT_HASH: sha };
  for (const profile of ['preview', 'production', 'development', '']) {
    assert.throws(
      () => appConfig({ config: expo }, { ...on, EAS_BUILD_PROFILE: profile }),
      /SC-6/,
      profile,
    );
  }
  for (const flag of [undefined, '0', 'true', '']) {
    const env = { EAS_BUILD_PROFILE: 'preview-diagnostics', EAS_BUILD_GIT_COMMIT_HASH: sha };
    if (flag !== undefined) env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS = flag;
    assert.throws(() => appConfig({ config: expo }, env), /SC-6/, String(flag));
  }
  // A diagnostics build is a separate app: its own identifier on both platforms and its own name.
  for (const env of [
    { ...on, EAS_BUILD_PROFILE: 'preview-diagnostics' },
    { EXPO_PUBLIC_CODELEX_DIAGNOSTICS: '1' },
  ]) {
    const config = appConfig(
      { config: expo },
      env,
      () => sha,
      () => '',
    );
    assert.equal(config.ios.bundleIdentifier, 'com.codelex.app.diagnostics');
    assert.equal(config.android.package, 'com.codelex.app.diagnostics');
    assert.equal(config.name, 'CODELEX Diagnostics');
    assert.equal(config.ios.supportsTablet, expo.ios.supportsTablet);
    assert.equal(config.android.allowBackup, false);
  }
  assert.equal(expo.ios.bundleIdentifier, 'com.codelex.app');
  assert.equal(expo.android.package, 'com.codelex.app');
  assert.equal(expo.name, 'CODELEX');
});

test('app.config.cjs S-n2: a local export from a dirty checkout is marked -dirty (EAS commits are not)', () => {
  const { resolveGitSha } = require('../app.config.cjs');
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  assert.equal(
    resolveGitSha(
      {},
      () => sha,
      () => ' M apps/mobile/app.json\n',
    ),
    `${sha}-dirty`,
  );
  assert.equal(
    resolveGitSha(
      {},
      () => sha,
      () => {
        throw new Error('no git');
      },
    ),
    `${sha}-dirty`,
  );
  assert.equal(
    resolveGitSha(
      {},
      () => sha,
      () => '\n',
    ),
    sha,
  );
  assert.equal(
    resolveGitSha(
      { EAS_BUILD_GIT_COMMIT_HASH: sha },
      () => {
        throw new Error('not called');
      },
      () => ' M x\n',
    ),
    sha,
  );
});

test('lint restates the draft-rules and UI bans in every new block (SC-2) and gates diagnostics imports', async () => {
  const eslint = new ESLint({ cwd: appDir });
  const optionsOf = async (file, rule) =>
    (await eslint.calculateConfigForFile(join(appDir, file))).rules[rule];
  const flat = (rule) => JSON.stringify(rule ?? null);
  for (const file of [
    'src/features/home/home-screen.tsx',
    'src/features/settings/settings-screen.tsx',
    'src/diagnostics/diagnostics-screen.tsx',
  ]) {
    const imports = flat(await optionsOf(file, 'no-restricted-imports'));
    assert.match(imports, /@codelex\/game-engine\/draft/, file);
    const syntax = flat(await optionsOf(file, 'no-restricted-syntax'));
    assert.match(syntax, /JSXText/, file);
    assert.match(syntax, /No literal colours/, file);
  }
  const feature = flat(
    await optionsOf('src/features/home/home-screen.tsx', 'no-restricted-imports'),
  );
  assert.match(feature, /\*\*\/diagnostics/);
  assert.match(feature, /@codelex\/golden-runner/);
  const featureSyntax = flat(
    await optionsOf('src/features/home/home-screen.tsx', 'no-restricted-syntax'),
  );
  assert.match(featureSyntax, /ImportExpression/);
  assert.match(featureSyntax, /Platform/);
  const gate = flat(
    await optionsOf('src/features/settings/settings-screen.tsx', 'no-restricted-imports'),
  );
  assert.doesNotMatch(gate, /\*\*\/diagnostics/);
  const diagnostics = 'src/diagnostics/diagnostics-screen.tsx';
  assert.match(
    flat(await optionsOf(diagnostics, 'no-restricted-globals')),
    /fetch.*XMLHttpRequest.*WebSocket/,
  );
  const diagImports = flat(await optionsOf(diagnostics, 'no-restricted-imports'));
  for (const banned of ['analytics', 'match-session', 'device-fs', 'zod'])
    assert.match(diagImports, new RegExp(banned));
  assert.match(
    flat(await optionsOf(diagnostics, '@typescript-eslint/no-restricted-imports')),
    /allowTypeImports/,
  );
  assert.doesNotMatch(flat(await optionsOf(diagnostics, 'no-restricted-syntax')), /Platform/);
  assert.equal(
    (await optionsOf(diagnostics, 'no-console'))?.[0] ??
      (await optionsOf(diagnostics, 'no-console')),
    2,
  );
});

test('metro keys its transform cache on every EXPO_PUBLIC_* variable, sorted (S-n1)', () => {
  const path = require.resolve('../metro.config.cjs');
  const saved = { ...process.env };
  const load = () => {
    delete require.cache[path];
    return require(path).cacheVersion;
  };
  try {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('EXPO_PUBLIC_')) delete process.env[key];
    }
    const none = load();
    process.env.EXPO_PUBLIC_CODELEX_FLAGS = 'play_vs_bot.enabled=1';
    process.env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS = '1';
    const both = load();
    assert.notEqual(both, none);
    const expected = JSON.stringify([
      ['EXPO_PUBLIC_CODELEX_DIAGNOSTICS', '1'],
      ['EXPO_PUBLIC_CODELEX_FLAGS', 'play_vs_bot.enabled=1'],
    ]);
    assert.ok(both.endsWith(`|env=${expected}`), both);
    process.env.EXPO_PUBLIC_CODELEX_FLAGS = '';
    assert.notEqual(load(), both);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[path];
  }
});
