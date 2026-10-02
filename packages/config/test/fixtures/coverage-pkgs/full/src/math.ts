export function sign(n: number): string {
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'zero';
}
