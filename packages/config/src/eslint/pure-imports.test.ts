import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { pureImportsRule } from './pure-imports.js';

const linter = new Linter();
const config: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { codelex: { rules: { 'pure-imports': pureImportsRule } } },
    rules: { 'codelex/pure-imports': ['error', { allow: ['^@codelex/lexicon$'] }] },
  },
];

function messages(code: string): string[] {
  return linter.verify(code, config, 'x.ts').map((m) => m.messageId ?? m.message);
}

describe('codelex/pure-imports', () => {
  it.each([
    "import { a } from './a.js';",
    "import type { T } from '../b.js';",
    "import { t } from '@codelex/lexicon';",
    "export { a } from './a.js';",
    "export * from './a.js';",
    'export const x = 1;',
    "const m = await import('./a.js');",
    'const m = await import(`./a.js`);',
    "const x = require('./a.js');",
    "type T = import('./a.js').A;",
    "import fs = require('./a.js');",
    "function require2(name: string): string { return name; } require2('x');",
  ])('allows: %s', (code) => {
    expect(messages(code)).toEqual([]);
  });

  it.each([
    ["import fs from 'node:fs';", 'forbidden'],
    ["export { x } from 'node:fs';", 'forbidden'],
    ["export * from 'pg';", 'forbidden'],
    ["const m = await import('node:fs');", 'forbidden'],
    ["const x = require('node:fs');", 'forbidden'],
    ["type T = import('pg').Client;", 'forbidden'],
    ["import fs = require('node:fs');", 'forbidden'],
    ["import { x } from '@codelex/lexicon/internal';", 'forbidden'],
    ['const m = await import(`node:${name}`);', 'dynamic'],
    ['const m = await import(name);', 'dynamic'],
    ['const x = require(name);', 'dynamic'],
    ['const x = require();', 'dynamic'],
  ])('rejects: %s', (code, messageId) => {
    expect(messages(code)).toContain(messageId);
  });

  it('names game-engine and its allow-list by default', () => {
    const [message] = linter.verify("import fs from 'node:fs';", config, 'x.ts');
    expect(message?.message).toBe(
      "'node:fs' is not on the game-engine allow-list (relative imports, @codelex/lexicon, @codelex/config/result): game-engine must stay pure (ENGINEERING §2).",
    );
  });

  it('names another pure package and its allow-list when configured', () => {
    const labelled: Linter.Config[] = [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { codelex: { rules: { 'pure-imports': pureImportsRule } } },
        rules: {
          'codelex/pure-imports': [
            'error',
            { allow: ['^zod$'], label: 'golden-runner', allowed: 'relative imports, zod' },
          ],
        },
      },
    ];
    const found = linter
      .verify("import fs from 'node:fs'; const m = await import(name);", labelled, 'x.ts')
      .map((m) => m.message);
    expect(found).toEqual([
      "'node:fs' is not on the golden-runner allow-list (relative imports, zod): golden-runner must stay pure (ENGINEERING §2).",
      'Module specifiers must be string literals in golden-runner so they can be checked (ENGINEERING §2).',
    ]);
  });
});
