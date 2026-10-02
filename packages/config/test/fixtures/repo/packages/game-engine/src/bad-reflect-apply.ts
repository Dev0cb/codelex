export function f(xs: number[]): void {
  Reflect.apply(Array.prototype.sort, xs, []);
}
