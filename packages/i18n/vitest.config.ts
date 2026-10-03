import { basePreset, defineCodelexVitest } from '@codelex/config/vitest';

// Base preset: 80 % on lines, statements, functions and branches.
export default defineCodelexVitest(basePreset);
