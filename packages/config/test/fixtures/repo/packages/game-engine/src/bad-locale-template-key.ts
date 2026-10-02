export function f(): number {
  return 'a'[`localeCompare`]('b');
}
