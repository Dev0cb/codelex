interface Versioned {
  readonly engineRulesVersion: 1 | 2;
}

export const atLeastTwo = (x: Versioned): boolean => (x.engineRulesVersion as number) >= 2;
