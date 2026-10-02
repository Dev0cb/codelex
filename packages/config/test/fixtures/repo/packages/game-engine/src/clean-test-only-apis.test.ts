// Tests may use BigInt, JSON.stringify, fractional probe values and async helpers
// (ADR-0013 §D4.2: BigInt "outside tests"; fc.asyncProperty and expect().resolves need Promise).
export const serialised: string = JSON.stringify({ a: 1 });
export const wide: bigint = 1n << 64n;
export const probe: boolean = Number.isInteger(1.5);
export async function later(): Promise<number> {
  return await Promise.resolve(1);
}
