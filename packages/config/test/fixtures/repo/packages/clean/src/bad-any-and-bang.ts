export function first(items: string[], raw: any): string {
  const found = items.find((i) => i === raw);
  return found!;
}
