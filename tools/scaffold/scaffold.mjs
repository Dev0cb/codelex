#!/usr/bin/env node
// Deterministic generator behind the /scaffold skill: creates a workspace package or service wired to
// @codelex/config (ESLint, Prettier, Vitest presets) and, for services, @codelex/observability.
// Zero dependencies. It only writes files; the caller runs `pnpm install` and the turbo tasks.
//
// Usage: node tools/scaffold/scaffold.mjs <packages|services>/<name> [--owner <agent>] [--preset base|strict]
//                                         [--description <text>] [--unlisted]
// CODELEX_ROOT overrides the repository root (tests).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CODELEX_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Packages for which the strict (90 %) coverage preset is mandatory (CLAUDE.md §5).
const STRICT_ONLY = new Set(['packages/game-engine', 'packages/protocol']);
// Tooling a package declares itself; versions are read from the root package.json so one version is
// resolved repo-wide and Dependabot bumps of the root reach new packages.
const PINNED_FROM_ROOT = ['@types/node', '@vitest/coverage-v8', 'fast-check', 'vitest'];

function devDependencies() {
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies ?? {};
  const deps = { '@codelex/config': 'workspace:*' };
  for (const name of PINNED_FROM_ROOT) {
    if (typeof root[name] !== 'string') fail(`root package.json has no devDependency ${name}`);
    deps[name] = root[name];
  }
  return deps;
}

function fail(message) {
  console.error(`scaffold: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { target: undefined, owner: undefined, preset: undefined, description: undefined, unlisted: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--') || v.trim() === '') fail(`${a} needs a value`);
      return v;
    };
    if (a === '--owner') opts.owner = value();
    else if (a === '--preset') opts.preset = value();
    else if (a === '--description') opts.description = value();
    else if (a === '--unlisted') opts.unlisted = true;
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else if (opts.target === undefined) opts.target = a;
    else fail(`unexpected argument ${a}`);
  }
  return opts;
}

// Reads the repository map (first code block of CLAUDE.md §2): "kind/" lines followed by
// "  name/ ... owner: agent" lines.
function repositoryMap() {
  const text = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const block = /^## 2\. Repository map\s*\n+```[^\n]*\n([\s\S]*?)\n```/m.exec(text);
  if (!block) fail('CLAUDE.md §2 "Repository map" code block not found');
  const map = new Map();
  let kind;
  for (const line of block[1].split('\n')) {
    const k = /^([a-z]+)\/\s*$/.exec(line);
    if (k) { kind = k[1]; continue; }
    const m = /^ {2}([a-z0-9-]+)\/\s+(.*?)\s+owner: ([a-z-]+)\s*$/.exec(line);
    if (m && kind) map.set(`${kind}/${m[1]}`, { purpose: m[2], owner: m[3] });
  }
  if (map.size === 0) fail('CLAUDE.md §2 repository map has no entries');
  return map;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

function packageFiles({ kind, name, owner, preset, description }) {
  const isService = kind === 'services';
  const scripts = {
    build: 'tsc -p tsconfig.build.json',
    lint: 'eslint .',
    typecheck: 'tsc -p tsconfig.json --noEmit',
    'format:check': 'prettier --check .',
    test: 'vitest run --coverage',
  };
  const pkg = {
    name: `@codelex/${name}`,
    version: '0.1.0',
    private: true,
    description,
    license: 'UNLICENSED',
    type: 'module',
    sideEffects: false,
    files: ['dist'],
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    scripts,
    ...(isService ? { dependencies: { '@codelex/observability': 'workspace:*' } } : {}),
    devDependencies: devDependencies(),
  };
  const presetName = preset === 'strict' ? 'strictPreset' : 'basePreset';
  const presetComment =
    preset === 'strict' ? 'Strict preset: 90 % on lines, statements, functions and branches.' : 'Base preset: 80 % on lines, statements, functions and branches.';

  const files = {
    'package.json': json(pkg),
    // Written verbatim (not JSON.stringify) so the files already match Prettier and format:check passes.
    'tsconfig.json': `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "*.ts", "*.js"],
  "exclude": ["dist", "coverage", "node_modules"]
}
`,
    'tsconfig.build.json': `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
`,
    'turbo.json': `{
  "$schema": "https://turbo.build/schema.json",
  "extends": ["//"],
  "tasks": {
    "lint": { "dependsOn": ["^build", "build"] },
    "format:check": { "dependsOn": ["^build", "build"] },
    "test": { "dependsOn": ["^build", "build"], "outputs": [] }
  }
}
`,
    'eslint.config.js': `import { codelex } from '@codelex/config/eslint';\n\nexport default codelex({ tsconfigRootDir: import.meta.dirname });\n`,
    'prettier.config.js': `export { prettierConfig as default } from '@codelex/config/prettier';\n`,
    '.prettierignore': 'dist\ncoverage\n',
    'vitest.config.ts': `import { ${presetName}, defineCodelexVitest } from '@codelex/config/vitest';\n\n// ${presetComment}\nexport default defineCodelexVitest(${presetName});\n`,
  };

  if (isService) {
    // Layering of ENGINEERING §2. Health is a pure function so the HTTP framework can be chosen later.
    files['src/domain/health.ts'] = `export type HealthStatus = 'ok' | 'degraded';

export interface HealthReport {
  readonly service: string;
  readonly status: HealthStatus;
  readonly checks: Readonly<Record<string, boolean>>;
}

/** Aggregates dependency checks: the service is \`ok\` only when every check passes. */
export function healthReport(
  service: string,
  checks: Readonly<Record<string, boolean>>,
): HealthReport {
  const status: HealthStatus = Object.values(checks).every(Boolean) ? 'ok' : 'degraded';
  return { service, status, checks };
}
`;
    files['src/domain/health.test.ts'] = `import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { healthReport } from './health.js';

describe('healthReport', () => {
  it('is ok without dependencies', () => {
    expect(healthReport('${name}', {}).status).toBe('ok');
  });

  it('is degraded as soon as one check fails', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.boolean()), (checks) => {
        const expected = Object.values(checks).includes(false) ? 'degraded' : 'ok';
        expect(healthReport('${name}', checks).status).toBe(expected);
      }),
    );
  });
});
`;
    files['src/app/logger.ts'] = `import { createLogger, parseLevel, type Logger } from '@codelex/observability';

/** The service logger. Redaction of PII and secrets is mandatory and built in. */
export function serviceLogger(level: string | undefined): Logger {
  return createLogger({ service: '${name}', level: parseLevel(level ?? 'info') });
}
`;
    files['src/app/logger.test.ts'] = `import { describe, expect, it } from 'vitest';

import { serviceLogger } from './logger.js';

describe('serviceLogger', () => {
  it('defaults to info', () => {
    expect(serviceLogger(undefined).level).toBe('info');
  });

  it('rejects an unknown level', () => {
    expect(() => serviceLogger('loud')).toThrow();
  });
});
`;
    files['src/index.ts'] = `export { healthReport, type HealthReport, type HealthStatus } from './domain/health.js';
export { serviceLogger } from './app/logger.js';
`;
  } else {
    const fn = camel(name);
    files['src/index.ts'] = `export { ${fn}Version } from './version.js';\n`;
    files['src/version.ts'] = `/** Version of the @codelex/${name} public API, bumped on breaking changes. */
export function ${fn}Version(): string {
  return '0.1.0';
}
`;
    files['src/version.test.ts'] = `import { describe, expect, it } from 'vitest';

import { ${fn}Version } from './index.js';

describe('${fn}Version', () => {
  it('is a semantic version', () => {
    expect(${fn}Version()).toMatch(/^\\d+\\.\\d+\\.\\d+$/);
  });
});
`;
  }

  files['README.md'] = `# @codelex/${name}

${description}

- Owner: \`${owner}\`
- Coverage preset: \`${preset}\` (\`@codelex/config/vitest\`)
- Scaffolded by \`tools/scaffold/scaffold.mjs\`. Replace the placeholder API below with the real one.

## API

${isService ? '`healthReport(service, checks)`, `serviceLogger(level)`.' : `\`${camel(name)}Version()\`.`}

## Commands

\`\`\`bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/${name}
\`\`\`

## Invariants

1. Lint, format and coverage rules come from \`@codelex/config\`; never lower a threshold or disable a rule here.
${isService ? '2. Logs go through `@codelex/observability` only (no `console.*`); never log PII, tokens or receipts.\n' : ''}`;
  return files;
}

function scaffold(argv) {
  const opts = parseArgs(argv);
  if (!opts.target) fail('missing target, e.g. packages/game-engine');
  const t = /^(packages|services|apps)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(opts.target);
  if (!t) fail(`invalid target "${opts.target}": expected packages/<kebab-name> or services/<kebab-name>`);
  const [, kind, name] = t;
  if (kind === 'apps') fail('apps are not supported yet: the Expo/Next presets arrive with the first app (E-1.4/E-1.5)');

  const listed = repositoryMap().get(opts.target);
  if (!listed && !opts.unlisted) fail(`${opts.target} is not in the repository map of CLAUDE.md §2: write an ADR first`);
  const owner = opts.owner ?? listed?.owner;
  if (!owner) fail('--owner is required for an unlisted target');
  if (!existsSync(join(ROOT, '.claude/agents', `${owner}.md`))) fail(`unknown owner agent "${owner}"`);

  const preset = opts.preset ?? (STRICT_ONLY.has(opts.target) ? 'strict' : 'base');
  if (preset !== 'base' && preset !== 'strict') fail(`invalid preset "${preset}": base or strict`);
  if (STRICT_ONLY.has(opts.target) && preset !== 'strict') fail(`${opts.target} requires the strict preset`);

  const description = opts.description ?? listed?.purpose ?? `CODELEX ${name}.`;
  const dir = join(ROOT, opts.target);
  if (existsSync(dir)) fail(`${opts.target} already exists`);
  // Workspace package names are global: @codelex/<name> must not exist under another kind.
  for (const other of ['packages', 'services', 'apps']) {
    if (existsSync(join(ROOT, other, name))) fail(`@codelex/${name} already exists in ${other}/${name}`);
  }

  const files = packageFiles({ kind, name, owner, preset, description });
  // Write into a sibling temp directory, then rename: a failure never leaves a half-generated target.
  mkdirSync(join(ROOT, kind), { recursive: true });
  const tmp = mkdtempSync(join(ROOT, kind, `.tmp-scaffold-${name}-`));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const file = join(tmp, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    renameSync(tmp, dir);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  console.log(`Scaffolded @codelex/${name} in ${opts.target} (owner ${owner}, ${preset} preset, ${Object.keys(files).length} files).`);
  console.log(`Next: pnpm install && pnpm turbo run lint typecheck format:check test --filter=@codelex/${name}`);
}

scaffold(process.argv.slice(2));
