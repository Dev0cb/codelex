interface Versioned {
  readonly engineRulesVersion: number;
}

export function bonus(x: Versioned): number {
  switch (x.engineRulesVersion) {
    case 1:
      return 16;
    default:
      return 8;
  }
}
