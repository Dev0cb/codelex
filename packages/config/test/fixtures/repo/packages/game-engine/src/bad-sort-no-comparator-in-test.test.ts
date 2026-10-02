import { expect, it } from "vitest";

it("determinism still applies to tests", () => {
  expect([2, 1].sort()).toEqual([1, 2]);
});
