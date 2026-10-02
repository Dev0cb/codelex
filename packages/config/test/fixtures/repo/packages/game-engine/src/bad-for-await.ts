export function f(xs: AsyncIterable<number>): void {
  void (async () => {
    for await (const x of xs) void x;
  })();
}
