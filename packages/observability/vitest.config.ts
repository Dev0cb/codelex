import { defineCodelexVitest, strictPreset } from '@codelex/config/vitest';

// This package guards PII: strict preset (90 % on lines, statements, functions, branches).
export default defineCodelexVitest(strictPreset);
