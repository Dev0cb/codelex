import { strictPreset, defineCodelexVitest } from '@codelex/config/vitest';

// Strict preset: 90 % on lines, statements, functions and branches.
export default defineCodelexVitest(strictPreset);
