interface Versioned {
  readonly engineRulesVersion: number;
}

const TABLE: ReadonlyMap<number, string> = new Map([[1, 'classic-v1']]);

// Reading the version to look data up is fine; comparing it with a constant is not.
export function layoutOf(x: Versioned, y: Versioned): string | undefined {
  if (x.engineRulesVersion !== y.engineRulesVersion) return undefined;
  return TABLE.get(x.engineRulesVersion);
}
