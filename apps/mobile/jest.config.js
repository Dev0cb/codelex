import { basePreset } from '@codelex/config/vitest';

// jest-expo runs React Native components under Jest (Vitest cannot load the Flow-typed react-native sources).
// Coverage thresholds are read from the shared base preset (80 %, ADR-0010) so they cannot drift.
export default {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: { global: { ...basePreset.test.coverage.thresholds } },
};
