interface Versioned {
  readonly engineRulesVersion: number;
}

export const half = (x: Versioned): number => x.engineRulesVersion * 0.5;
