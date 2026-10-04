interface Versioned {
  readonly engineRulesVersion: number;
}

// Tests may assert on versions.
export const isOne = (x: Versioned): boolean => x.engineRulesVersion === 1;
