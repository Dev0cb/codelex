export function f(): void {
  queueMicrotask(() => undefined);
}
