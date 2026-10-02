import type { Rule } from 'eslint';

interface SourceNode {
  readonly type: string;
  readonly value?: unknown;
  readonly quasis?: readonly { readonly value: { readonly cooked?: string | null | undefined } }[];
  readonly expressions?: readonly unknown[];
}

interface Options {
  readonly allow?: readonly string[];
}

/**
 * Allow-list for module specifiers: relative imports (cross-package escapes are judged by the
 * boundaries rule) and the listed patterns only. Covers static imports, re-exports, dynamic
 * `import()`, `require()` and `import x = require()`; non-literal specifiers are always rejected.
 */
export const pureImportsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden:
        "'{{source}}' is not on the game-engine allow-list (relative imports, @codelex/lexicon, @codelex/config/result): game-engine must stay pure (ENGINEERING §2).",
      dynamic:
        'Module specifiers must be string literals in game-engine so they can be checked (ENGINEERING §2).',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const allow = (options.allow ?? []).map((pattern) => new RegExp(pattern));

    function specifier(node: SourceNode | null | undefined): string | null | undefined {
      if (!node) return undefined;
      if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
      if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) {
        return node.quasis?.[0]?.value.cooked ?? null;
      }
      return null;
    }

    function check(report: Rule.Node, source: SourceNode | null | undefined): void {
      const value = specifier(source);
      if (value === undefined) return;
      if (value === null) {
        context.report({ node: report, messageId: 'dynamic' });
        return;
      }
      if (value.startsWith('.') || allow.some((re) => re.test(value))) return;
      context.report({ node: report, messageId: 'forbidden', data: { source: value } });
    }

    const tsListeners: Record<string, (node: Rule.Node) => void> = {
      TSExternalModuleReference: (node) => {
        check(node, (node as unknown as { expression: SourceNode }).expression);
      },
      TSImportType: (node) => {
        check(node, (node as unknown as { source: SourceNode }).source);
      },
    };

    return {
      ...tsListeners,
      ImportDeclaration: (node) => {
        check(node, node.source);
      },
      ExportAllDeclaration: (node) => {
        check(node, node.source);
      },
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node, node.source);
      },
      ImportExpression: (node) => {
        check(node, node.source);
      },
      CallExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          const [first] = node.arguments;
          if (first) check(node, first);
          else context.report({ node, messageId: 'dynamic' });
        }
      },
    };
  },
};
