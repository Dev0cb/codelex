import { tooling } from '@codelex/config/eslint';

// Tests may import tooling and test libraries; the purity allow-list covers shipped code only.
export const linter = tooling;
