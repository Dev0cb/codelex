import { configDefaults } from 'vitest/config';
import { defineCodelexVitest, strictPreset } from './src/vitest/index.js';

// packages/config dogfoods its own strict preset (>= 90 % on all four metrics).
export default defineCodelexVitest(strictPreset, {
  test: { exclude: [...configDefaults.exclude, 'test/fixtures/**', '.tmp-*/**'] },
});
