export function fmt(x: number): string {
  return new Intl.NumberFormat("en").format(x);
}
