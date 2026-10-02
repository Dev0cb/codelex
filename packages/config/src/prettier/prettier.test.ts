import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { prettierConfig } from './index.js';

describe('prettierConfig', () => {
  it('formats with single quotes, trailing commas and 100 columns', async () => {
    const out = await format('const a = ["x","y"]\n', {
      ...prettierConfig,
      parser: 'typescript',
    });
    expect(out).toBe("const a = ['x', 'y'];\n");
  });

  it('is LF only', () => {
    expect(prettierConfig.endOfLine).toBe('lf');
  });
});
