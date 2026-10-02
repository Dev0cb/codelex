// Tests may use BigInt, JSON.stringify and fractional probe values (ADR-0013 §D4.2: BigInt "outside tests").
export const serialised: string = JSON.stringify({ a: 1 });
export const wide: bigint = 1n << 64n;
export const probe: boolean = Number.isInteger(1.5);
