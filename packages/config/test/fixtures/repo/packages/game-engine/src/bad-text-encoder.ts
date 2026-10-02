export function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
