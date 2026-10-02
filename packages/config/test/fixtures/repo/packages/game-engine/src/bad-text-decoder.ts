export function dec(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}
