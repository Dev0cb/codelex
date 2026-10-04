export const notTwo = (x: Readonly<Record<string, unknown>>): boolean =>
  x['engineRulesVersion'] !== 2;
