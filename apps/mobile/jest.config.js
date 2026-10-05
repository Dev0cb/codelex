import { basePreset } from '@codelex/config/vitest';

// jest-expo runs React Native components under Jest (Vitest cannot load the Flow-typed react-native sources).
// Coverage thresholds are read from the shared base preset (80 %, ADR-0010) so they cannot drift.
export default {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  // A `.clxi` import yields the asset's path; tests that load the bundled lexicon mock expo-asset, expo-file-system
  // and expo-crypto with the Node stand-ins in jest/ (`jest.mock(name, () => jest.requireActual(...))`), so they
  // verify the very bytes `prepare:lexicon` generated. Unit tests of the loader inject their own sources.
  transform: { '\\.clxi$': '<rootDir>/jest/clxi-transformer.cjs' },
  // jest/resolver.cjs picks the JS (non-native) sources of react-native-worklets so Reanimated and worklets run on
  // the JS thread in Jest; jest/setup.cjs installs the Gesture Handler mocks and the Skia stand-in.
  resolver: '<rootDir>/jest/resolver.cjs',
  setupFiles: ['<rootDir>/jest/setup.cjs'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: { global: { ...basePreset.test.coverage.thresholds } },
};
