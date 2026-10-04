interface Versioned {
  readonly engineRulesVersion: number;
}

export const isOne = (x: Versioned): boolean => x.engineRulesVersion === 1;
