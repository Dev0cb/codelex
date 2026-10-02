export function every(fn: () => void): void {
  setInterval(fn, 10);
}
