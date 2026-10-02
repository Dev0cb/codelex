// Test-only typing of the lexicon's untyped RFC 8785 module (packages/lexicon/scripts/canonical.mjs),
// used as the differential reference in src/hash/jcs.test.ts. Remove once @codelex/lexicon ships its own
// declarations (sprint L2: lexicon package to TypeScript).
declare module '@codelex/lexicon/canonical' {
  /** RFC 8785 canonical JSON; throws TypeError on anything that is not plain JSON. */
  export function canonicalize(value: unknown): string;
}
