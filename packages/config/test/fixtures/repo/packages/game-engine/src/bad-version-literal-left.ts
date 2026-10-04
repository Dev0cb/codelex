interface Versioned {
  readonly engineRulesVersion: number;
}

export const notTwo = (x: Versioned): boolean => 2 !== x.engineRulesVersion;
