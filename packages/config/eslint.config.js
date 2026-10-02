import { codelex } from './dist/eslint/index.js';

export default [
  ...codelex({ tsconfigRootDir: import.meta.dirname }),
  { ignores: ['test/fixtures/**'] },
];
